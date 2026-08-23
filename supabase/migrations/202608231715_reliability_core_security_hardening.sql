begin;

create or replace function public.redact_reliability_text(raw_message text)
returns text language sql immutable as $$
  select left(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            coalesce(raw_message,''),
            'https?://[^[:space:]<>]+',
            '[redacted-url]',
            'gi'
          ),
          '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}',
          '[redacted-email]',
          'gi'
        ),
        '(Bearer[[:space:]]+|sk-|sb_secret_)[A-Za-z0-9._~+/-]{12,}',
        '[redacted-secret]',
        'gi'
      ),
      '(token|secret|password|cookie)[=:][^[:space:],;]{8,}',
      '[redacted-secret]',
      'gi'
    ),
    2000
  );
$$;

create or replace function public.ingest_reliability_event(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id text := nullif(btrim(p_event->>'event_id'), '');
  v_source_system text := nullif(btrim(p_event->>'source_system'), '');
  v_engine text := nullif(btrim(p_event->>'engine'), '');
  v_event_type text := coalesce(nullif(btrim(p_event->>'event_type'), ''), 'run.status');
  v_status text := coalesce(nullif(btrim(p_event->>'status'), ''), 'progress');
  v_severity text := coalesce(nullif(btrim(p_event->>'severity'), ''), 'info');
  v_risk_level text := coalesce(nullif(btrim(p_event->>'risk_level'), ''), 'low');
  v_run_id text := nullif(btrim(p_event->>'run_id'), '');
  v_correlation_id text := coalesce(nullif(btrim(p_event->>'correlation_id'), ''), v_run_id, v_event_id);
  v_signature text := nullif(btrim(p_event->>'incident_signature'), '');
  v_error_code text := nullif(btrim(p_event->>'error_code'), '');
  v_error_message text := nullif(public.redact_reliability_text(p_event->>'error_message'), '');
  v_occurred_at timestamptz := coalesce(nullif(p_event->>'occurred_at','')::timestamptz, now());
  v_event_row_id uuid;
  v_incident_id uuid;
  v_occurrence_count bigint := 0;
  v_policy public.reliability_recovery_policies%rowtype;
  v_failure_like boolean;
  v_auto_recovery boolean := coalesce((p_event->>'automatic_recovery')::boolean, false);
  v_retry_count integer := greatest(0, coalesce((p_event->>'retry_count')::integer, 0));
begin
  if v_event_id is null or v_source_system is null or v_engine is null then
    raise exception 'event_id, source_system and engine are required';
  end if;
  if v_status not in ('started','progress','succeeded','failed','blocked','retrying','quality_rejected','recovered','canceled') then
    raise exception 'unsupported reliability status: %', v_status;
  end if;
  if v_severity not in ('info','warning','error','critical') then
    raise exception 'unsupported reliability severity: %', v_severity;
  end if;
  if v_risk_level not in ('low','medium','high','critical') then
    raise exception 'unsupported reliability risk level: %', v_risk_level;
  end if;

  insert into public.reliability_events(
    event_id,schema_version,source_system,engine,event_type,status,severity,risk_level,
    run_id,correlation_id,incident_signature,stage,error_code,error_message,duration_ms,
    retry_count,automatic_recovery,recovery_action,quality_signals,metrics,metadata,occurred_at
  ) values (
    v_event_id,
    greatest(1,least(100,coalesce((p_event->>'schema_version')::integer,1))),
    left(v_source_system,120),left(v_engine,160),left(v_event_type,160),v_status,v_severity,v_risk_level,
    left(v_run_id,300),left(v_correlation_id,300),left(v_signature,300),
    left(nullif(btrim(p_event->>'stage'),''),160),left(v_error_code,160),v_error_message,
    case when p_event ? 'duration_ms' then greatest(0,(p_event->>'duration_ms')::bigint) else null end,
    v_retry_count,v_auto_recovery,left(nullif(btrim(p_event->>'recovery_action'),''),160),
    coalesce(p_event->'quality_signals','{}'::jsonb),coalesce(p_event->'metrics','{}'::jsonb),
    coalesce(p_event->'metadata','{}'::jsonb),v_occurred_at
  )
  on conflict (source_system,event_id) do nothing
  returning id into v_event_row_id;

  if v_event_row_id is null then
    select id,incident_id into v_event_row_id,v_incident_id
    from public.reliability_events
    where source_system=left(v_source_system,120) and event_id=v_event_id;
    return jsonb_build_object('ok',true,'duplicate',true,'event_row_id',v_event_row_id,'incident_id',v_incident_id);
  end if;

  v_failure_like := v_status in ('failed','blocked','retrying','quality_rejected');

  if v_signature is not null and v_status='recovered' then
    select id,occurrence_count into v_incident_id,v_occurrence_count
    from public.reliability_incidents
    where source_system=left(v_source_system,120)
      and engine=left(v_engine,160)
      and signature=left(v_signature,300);

    if v_incident_id is not null then
      update public.reliability_incidents
      set status=case when status='ignored' then 'ignored' else 'monitoring' end,
          last_seen_at=greatest(last_seen_at,v_occurred_at),
          automatic_recovery_attempts=automatic_recovery_attempts+case when v_auto_recovery then 1 else 0 end,
          automatic_recovery_successes=automatic_recovery_successes+1,
          last_recovery_action=coalesce(left(nullif(btrim(p_event->>'recovery_action'),''),160),last_recovery_action),
          last_source_event_id=v_event_id,
          metadata=metadata||jsonb_build_object('lastStage',nullif(btrim(p_event->>'stage'),'')),
          updated_at=now()
      where id=v_incident_id;
      update public.reliability_events set incident_id=v_incident_id where id=v_event_row_id;
    end if;

    return jsonb_build_object('ok',true,'duplicate',false,'event_row_id',v_event_row_id,
      'incident_id',v_incident_id,'occurrence_count',v_occurrence_count);
  end if;

  if v_signature is not null and v_failure_like then
    insert into public.reliability_incidents(
      source_system,engine,signature,title,status,severity,risk_level,error_code,latest_message,
      first_seen_at,last_seen_at,occurrence_count,automatic_recovery_attempts,
      automatic_recovery_successes,last_recovery_action,last_source_event_id,metadata
    ) values (
      left(v_source_system,120),left(v_engine,160),left(v_signature,300),
      coalesce(v_error_code,left(v_signature,200)),'open',
      v_severity,v_risk_level,left(v_error_code,160),v_error_message,v_occurred_at,v_occurred_at,1,
      case when v_auto_recovery or v_status='retrying' then 1 else 0 end,0,
      left(nullif(btrim(p_event->>'recovery_action'),''),160),v_event_id,
      jsonb_build_object('lastStage',nullif(btrim(p_event->>'stage'),''))
    )
    on conflict (source_system,engine,signature) do update set
      title=coalesce(nullif(excluded.title,''),public.reliability_incidents.title),
      status=case when public.reliability_incidents.status='ignored' then 'ignored' else 'open' end,
      severity=case
        when excluded.severity='critical' or public.reliability_incidents.severity='critical' then 'critical'
        when excluded.severity='error' or public.reliability_incidents.severity='error' then 'error'
        when excluded.severity='warning' or public.reliability_incidents.severity='warning' then 'warning'
        else 'info' end,
      risk_level=case
        when excluded.risk_level='critical' or public.reliability_incidents.risk_level='critical' then 'critical'
        when excluded.risk_level='high' or public.reliability_incidents.risk_level='high' then 'high'
        when excluded.risk_level='medium' or public.reliability_incidents.risk_level='medium' then 'medium'
        else 'low' end,
      error_code=coalesce(excluded.error_code,public.reliability_incidents.error_code),
      latest_message=coalesce(excluded.latest_message,public.reliability_incidents.latest_message),
      last_seen_at=greatest(public.reliability_incidents.last_seen_at,excluded.last_seen_at),
      occurrence_count=public.reliability_incidents.occurrence_count+1,
      automatic_recovery_attempts=public.reliability_incidents.automatic_recovery_attempts+excluded.automatic_recovery_attempts,
      last_recovery_action=coalesce(excluded.last_recovery_action,public.reliability_incidents.last_recovery_action),
      last_source_event_id=excluded.last_source_event_id,
      metadata=public.reliability_incidents.metadata||excluded.metadata,
      updated_at=now()
    returning id,occurrence_count into v_incident_id,v_occurrence_count;

    update public.reliability_events set incident_id=v_incident_id where id=v_event_row_id;

    if v_occurrence_count>=2 then
      update public.reliability_incidents
      set learning_state=case when learning_state='untracked' then 'candidate' else learning_state end,
          regression_state=case when regression_state='untracked' then 'proposed' else regression_state end,
          updated_at=now()
      where id=v_incident_id;

      insert into public.reliability_learning_cases(
        incident_id,state,title,symptom,prevention_rule,confidence,evidence
      )
      select v_incident_id,'candidate',coalesce(v_error_code,left(v_signature,200)),
        coalesce(v_error_message,'반복 운영 오류가 감지되었습니다.'),
        '동일 오류가 다시 발생하지 않도록 결정적 검증 규칙과 회귀 테스트를 추가합니다.',
        least(0.95,0.45+(least(v_occurrence_count,10)::numeric*0.05)),
        jsonb_build_object('occurrenceCount',v_occurrence_count,'sourceSystem',v_source_system,
          'engine',v_engine,'signature',v_signature,'latestEventId',v_event_id)
      where not exists (
        select 1 from public.reliability_learning_cases
        where incident_id=v_incident_id and state='candidate'
      );

      insert into public.reliability_regression_cases(
        incident_id,source_repo,test_name,protected_invariant,status,evidence
      )
      select v_incident_id,
        case when v_source_system='ai-saurus' then 'andysong111/commerce-os-detail-page-saas' else 'andysong111/commerce-os-ops-center' end,
        concat('reliability regression: ',coalesce(v_error_code,left(v_signature,120))),
        concat('The failure signature ',v_signature,' must be deterministically detected or prevented before production completion.'),
        'proposed',jsonb_build_object('occurrenceCount',v_occurrence_count,'latestEventId',v_event_id)
      where not exists (
        select 1 from public.reliability_regression_cases
        where incident_id=v_incident_id and status='proposed'
      );
    end if;

    select * into v_policy from public.reliability_recovery_policies
    where enabled=true and source_system=left(v_source_system,120)
      and engine=left(v_engine,160) and error_code=coalesce(v_error_code,'') limit 1;

    if found and v_retry_count<v_policy.max_attempts then
      insert into public.reliability_recovery_queue(
        event_id,incident_id,source_system,engine,run_id,action,status,
        attempt_count,max_attempts,not_before,payload
      ) values (
        v_event_row_id,v_incident_id,left(v_source_system,120),left(v_engine,160),left(v_run_id,300),v_policy.action,
        case when v_policy.requires_approval or v_policy.risk_level in ('high','critical') then 'approval_required' else 'queued' end,
        v_retry_count,v_policy.max_attempts,now()+make_interval(secs=>v_policy.backoff_seconds),
        jsonb_build_object('sourceEventId',v_event_id,'errorCode',v_error_code,
          'stage',nullif(btrim(p_event->>'stage'),''),'riskLevel',v_policy.risk_level,
          'requiresApproval',v_policy.requires_approval)
      ) on conflict (event_id,action) do nothing;
    end if;
  end if;

  return jsonb_build_object('ok',true,'duplicate',false,'event_row_id',v_event_row_id,
    'incident_id',v_incident_id,'occurrence_count',v_occurrence_count);
end;
$$;

revoke all on function public.ingest_reliability_event(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_reliability_event(jsonb) to service_role;

-- Existing rows are re-redacted so deployments upgraded from earlier migrations
-- retain the same privacy guarantees as fresh installations.
update public.reliability_events
set error_message=nullif(public.redact_reliability_text(error_message),'')
where error_message is not null;
update public.reliability_incidents
set latest_message=nullif(public.redact_reliability_text(latest_message),'')
where latest_message is not null;
update public.reliability_recovery_queue
set last_error=nullif(public.redact_reliability_text(last_error),'')
where last_error is not null;

comment on function public.ingest_reliability_event(jsonb) is 'Service-role-only reliability ingestion. Recovery signals update recovery outcome without incrementing failure recurrence.';

commit;
