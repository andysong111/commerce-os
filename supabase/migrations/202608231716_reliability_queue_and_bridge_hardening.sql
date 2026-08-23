begin;

create or replace function public.map_reliability_status(raw_status text)
returns text language sql immutable as $$
  select case lower(coalesce(raw_status,''))
    when 'success' then 'succeeded'
    when 'succeeded' then 'succeeded'
    when 'complete' then 'succeeded'
    when 'completed' then 'succeeded'
    when 'ready' then 'succeeded'
    when 'passed' then 'succeeded'
    when 'failed' then 'failed'
    when 'error' then 'failed'
    when 'partial_failure' then 'failed'
    when 'partial' then 'failed'
    when 'blocked' then 'blocked'
    when 'approval_required' then 'blocked'
    when 'review_required' then 'blocked'
    when 'quality_review_required' then 'quality_rejected'
    when 'retrying' then 'retrying'
    when 'retry_pending' then 'retrying'
    when 'queued' then 'started'
    when 'pending' then 'started'
    when 'running' then 'progress'
    when 'processing' then 'progress'
    when 'in_progress' then 'progress'
    when 'canceled' then 'canceled'
    when 'cancelled' then 'canceled'
    else 'progress'
  end;
$$;

create or replace function public.claim_reliability_learning_analysis(p_limit integer default 3)
returns table(
  job_id uuid,
  learning_case_id uuid,
  incident_id uuid,
  source_system text,
  engine text,
  signature text,
  title text,
  error_code text,
  severity text,
  risk_level text,
  occurrence_count bigint,
  latest_message text,
  symptom text,
  current_confidence numeric,
  case_evidence jsonb,
  recent_events jsonb,
  attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select q.id
    from public.reliability_learning_analysis_queue q
    where (
        (q.status in ('pending','failed') and q.not_before <= now())
        or (q.status='running' and q.locked_at is not null and q.locked_at <= now()-interval '10 minutes')
      )
      and q.attempts < q.max_attempts
    order by q.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 3), 5))
  ), claimed as (
    update public.reliability_learning_analysis_queue q
    set status = 'running',
        attempts = q.attempts + 1,
        locked_at = now(),
        updated_at = now()
    from candidates c
    where q.id = c.id
    returning q.id, q.learning_case_id, q.incident_id, q.attempts
  )
  select
    c.id,
    l.id,
    i.id,
    i.source_system,
    i.engine,
    i.signature,
    coalesce(nullif(l.title, ''), nullif(i.title, ''), i.signature),
    i.error_code,
    i.severity,
    i.risk_level,
    i.occurrence_count,
    i.latest_message,
    l.symptom,
    l.confidence,
    l.evidence,
    coalesce((
      select jsonb_agg(rows.event_payload order by rows.occurred_at desc)
      from (
        select
          e.occurred_at,
          jsonb_strip_nulls(jsonb_build_object(
            'status', e.status,
            'stage', e.stage,
            'errorCode', e.error_code,
            'errorMessage', e.error_message,
            'retryCount', e.retry_count,
            'automaticRecovery', e.automatic_recovery,
            'recoveryAction', e.recovery_action,
            'qualitySignals', e.quality_signals,
            'metrics', e.metrics,
            'occurredAt', e.occurred_at
          )) as event_payload
        from public.reliability_events e
        where e.incident_id = i.id
        order by e.occurred_at desc
        limit 5
      ) rows
    ), '[]'::jsonb),
    c.attempts
  from claimed c
  join public.reliability_learning_cases l on l.id = c.learning_case_id
  join public.reliability_incidents i on i.id = c.incident_id;
end;
$$;

create or replace function public.fail_reliability_learning_analysis(
  p_job_id uuid,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
  v_max_attempts integer;
begin
  select attempts, max_attempts
  into v_attempts, v_max_attempts
  from public.reliability_learning_analysis_queue
  where id = p_job_id and status = 'running'
  for update;

  if v_attempts is null then
    return false;
  end if;

  update public.reliability_learning_analysis_queue
  set status = case when v_attempts >= v_max_attempts then 'dead_letter' else 'failed' end,
      not_before = case
        when v_attempts >= v_max_attempts then not_before
        else now() + make_interval(secs => least(21600, 60 * (2 ^ greatest(0, least(v_attempts - 1, 8)))::integer))
      end,
      locked_at = null,
      last_error = nullif(public.redact_reliability_text(coalesce(p_error, 'unknown analysis failure')),''),
      updated_at = now()
  where id = p_job_id;

  return true;
end;
$$;

revoke all on function public.ingest_reliability_event(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_reliability_event(jsonb) to service_role;
revoke all on function public.claim_reliability_learning_analysis(integer) from public, anon, authenticated;
revoke all on function public.complete_reliability_learning_analysis(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.fail_reliability_learning_analysis(uuid,text) from public, anon, authenticated;
grant execute on function public.claim_reliability_learning_analysis(integer) to service_role;
grant execute on function public.complete_reliability_learning_analysis(uuid,text,jsonb) to service_role;
grant execute on function public.fail_reliability_learning_analysis(uuid,text) to service_role;
revoke all on function public.enqueue_reliability_learning_analysis() from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.bridge_commerce_operation_run_to_reliability()') is not null then
    execute 'revoke all on function public.bridge_commerce_operation_run_to_reliability() from public, anon, authenticated';
  end if;
  if to_regprocedure('public.bridge_keyword_stage_to_reliability()') is not null then
    execute 'revoke all on function public.bridge_keyword_stage_to_reliability() from public, anon, authenticated';
  end if;
  if to_regprocedure('public.bridge_product_launch_upload_to_reliability()') is not null then
    execute 'revoke all on function public.bridge_product_launch_upload_to_reliability() from public, anon, authenticated';
  end if;
  if to_regprocedure('public.bridge_seo_dispatch_to_reliability()') is not null then
    execute 'revoke all on function public.bridge_seo_dispatch_to_reliability() from public, anon, authenticated';
  end if;
end;
$$;

comment on function public.claim_reliability_learning_analysis(integer) is 'Service-role-only claim with a ten-minute lease so abandoned analysis jobs can be reclaimed.';

commit;
