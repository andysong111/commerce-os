begin;

create table if not exists public.reliability_incidents (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  engine text not null,
  signature text not null,
  title text not null default '',
  status text not null default 'open' check (status in ('open','monitoring','resolved','ignored')),
  severity text not null default 'warning' check (severity in ('info','warning','error','critical')),
  risk_level text not null default 'low' check (risk_level in ('low','medium','high','critical')),
  error_code text,
  latest_message text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrence_count bigint not null default 1 check (occurrence_count > 0),
  automatic_recovery_attempts bigint not null default 0 check (automatic_recovery_attempts >= 0),
  automatic_recovery_successes bigint not null default 0 check (automatic_recovery_successes >= 0),
  last_recovery_action text,
  last_source_event_id text,
  learning_state text not null default 'untracked' check (learning_state in ('untracked','candidate','approved','rejected','applied')),
  regression_state text not null default 'untracked' check (regression_state in ('untracked','proposed','implemented','passing','failing','retired')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, engine, signature)
);

create table if not exists public.reliability_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  schema_version integer not null default 1 check (schema_version between 1 and 100),
  source_system text not null,
  engine text not null,
  event_type text not null,
  status text not null check (status in ('started','progress','succeeded','failed','blocked','retrying','quality_rejected','recovered','canceled')),
  severity text not null default 'info' check (severity in ('info','warning','error','critical')),
  risk_level text not null default 'low' check (risk_level in ('low','medium','high','critical')),
  run_id text,
  correlation_id text not null,
  incident_signature text,
  incident_id uuid references public.reliability_incidents(id) on delete set null,
  stage text,
  error_code text,
  error_message text,
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  retry_count integer not null default 0 check (retry_count >= 0),
  automatic_recovery boolean not null default false,
  recovery_action text,
  quality_signals jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  ingested_at timestamptz not null default now(),
  unique (source_system, event_id)
);

create table if not exists public.reliability_learning_cases (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.reliability_incidents(id) on delete cascade,
  state text not null default 'candidate' check (state in ('candidate','approved','rejected','applied','superseded')),
  title text not null,
  symptom text not null default '',
  root_cause text not null default '',
  resolution text not null default '',
  prevention_rule text not null default '',
  confidence numeric(5,4) not null default 0 check (confidence between 0 and 1),
  evidence jsonb not null default '{}'::jsonb,
  approved_by text,
  approved_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reliability_regression_cases (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.reliability_incidents(id) on delete cascade,
  source_repo text not null,
  test_path text not null default '',
  test_name text not null,
  protected_invariant text not null,
  status text not null default 'proposed' check (status in ('proposed','implemented','passing','failing','retired')),
  workflow_name text,
  commit_sha text,
  last_run_at timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reliability_recovery_policies (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  engine text not null,
  error_code text not null,
  action text not null,
  max_attempts integer not null default 1 check (max_attempts between 0 and 10),
  backoff_seconds integer not null default 30 check (backoff_seconds between 0 and 86400),
  risk_level text not null default 'low' check (risk_level in ('low','medium','high','critical')),
  requires_approval boolean not null default false,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, engine, error_code)
);

create table if not exists public.reliability_recovery_queue (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.reliability_events(id) on delete cascade,
  incident_id uuid references public.reliability_incidents(id) on delete set null,
  source_system text not null,
  engine text not null,
  run_id text,
  action text not null,
  status text not null default 'queued' check (status in ('queued','approval_required','running','succeeded','failed','canceled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 1 check (max_attempts between 0 and 10),
  not_before timestamptz not null default now(),
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, action)
);

create index if not exists reliability_events_occurred_idx on public.reliability_events(occurred_at desc);
create index if not exists reliability_events_source_engine_idx on public.reliability_events(source_system, engine, occurred_at desc);
create index if not exists reliability_events_signature_idx on public.reliability_events(incident_signature, occurred_at desc) where incident_signature is not null;
create index if not exists reliability_events_status_idx on public.reliability_events(status, severity, occurred_at desc);
create index if not exists reliability_incidents_attention_idx on public.reliability_incidents(status, severity, last_seen_at desc);
create index if not exists reliability_incidents_learning_idx on public.reliability_incidents(learning_state, occurrence_count desc, last_seen_at desc);
create index if not exists reliability_learning_cases_state_idx on public.reliability_learning_cases(state, updated_at desc);
create unique index if not exists reliability_learning_case_open_candidate_uq on public.reliability_learning_cases(incident_id) where state = 'candidate';
create index if not exists reliability_regression_cases_status_idx on public.reliability_regression_cases(status, updated_at desc);
create unique index if not exists reliability_regression_open_proposal_uq on public.reliability_regression_cases(incident_id) where status = 'proposed';
create index if not exists reliability_recovery_queue_ready_idx on public.reliability_recovery_queue(status, not_before, created_at) where status in ('queued','approval_required');

create or replace function public.set_reliability_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'reliability_incidents','reliability_learning_cases','reliability_regression_cases',
    'reliability_recovery_policies','reliability_recovery_queue'
  ] loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', table_name, table_name);
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_reliability_updated_at()', table_name, table_name);
  end loop;
end;
$$;

insert into public.reliability_recovery_policies(
  source_system, engine, error_code, action, max_attempts, backoff_seconds,
  risk_level, requires_approval, enabled, metadata
) values
  ('ai-saurus','detail-page-generation','missing_identity_anchor','retry_representative_with_identity_anchor',2,20,'low',false,true,'{"preserveApprovedAssets":true}'::jsonb),
  ('ai-saurus','detail-page-generation','commerce_image_generation_error','retry_image_generation',2,30,'low',false,true,'{"preserveApprovedAssets":true}'::jsonb),
  ('ai-saurus','detail-page-generation','ASSET_PERSISTENCE_FAILED','retry_asset_persistence',3,45,'low',false,true,'{"idempotent":true}'::jsonb),
  ('ai-saurus','detail-page-generation','ASSET_PACKAGE_NOT_READY','wait_then_retry_persistence',3,60,'low',false,true,'{"idempotent":true}'::jsonb),
  ('ai-saurus','detail-page-generation','QUALITY_REVIEW_REQUIRED','queue_quality_review',1,0,'medium',true,true,'{"automaticCodeChange":false}'::jsonb),
  ('ai-saurus','detail-page-generation','mismatched_project','block_and_review_input_identity',0,0,'high',true,true,'{"automaticCodeChange":false}'::jsonb)
on conflict (source_system, engine, error_code) do update set
  action=excluded.action,
  max_attempts=excluded.max_attempts,
  backoff_seconds=excluded.backoff_seconds,
  risk_level=excluded.risk_level,
  requires_approval=excluded.requires_approval,
  enabled=excluded.enabled,
  metadata=excluded.metadata,
  updated_at=now();

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
  v_error_message text := nullif(left(btrim(p_event->>'error_message'), 2000), '');
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

  if v_signature is not null and (v_failure_like or v_status='recovered') then
    insert into public.reliability_incidents(
      source_system,engine,signature,title,status,severity,risk_level,error_code,latest_message,
      first_seen_at,last_seen_at,occurrence_count,automatic_recovery_attempts,
      automatic_recovery_successes,last_recovery_action,last_source_event_id,metadata
    ) values (
      left(v_source_system,120),left(v_engine,160),left(v_signature,300),
      coalesce(v_error_code,left(v_signature,200)),
      case when v_status='recovered' then 'monitoring' else 'open' end,
      v_severity,v_risk_level,left(v_error_code,160),v_error_message,v_occurred_at,v_occurred_at,1,
      case when v_auto_recovery or v_status='retrying' then 1 else 0 end,
      case when v_status='recovered' then 1 else 0 end,
      left(nullif(btrim(p_event->>'recovery_action'),''),160),v_event_id,
      jsonb_build_object('lastStage',nullif(btrim(p_event->>'stage'),''))
    )
    on conflict (source_system,engine,signature) do update set
      title=coalesce(nullif(excluded.title,''),public.reliability_incidents.title),
      status=case when excluded.status='monitoring' then 'monitoring' when public.reliability_incidents.status='ignored' then 'ignored' else 'open' end,
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
      automatic_recovery_successes=public.reliability_incidents.automatic_recovery_successes+excluded.automatic_recovery_successes,
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

    if found and v_failure_like and v_retry_count<v_policy.max_attempts then
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

alter table public.reliability_incidents enable row level security;
alter table public.reliability_events enable row level security;
alter table public.reliability_learning_cases enable row level security;
alter table public.reliability_regression_cases enable row level security;
alter table public.reliability_recovery_policies enable row level security;
alter table public.reliability_recovery_queue enable row level security;

comment on table public.reliability_events is 'Privacy-minimized normalized execution telemetry from Commerce OS and AI-Saurus.';
comment on table public.reliability_incidents is 'Deduplicated operational failure signatures with recurrence and recovery outcomes.';
comment on table public.reliability_learning_cases is 'Curated learning assets promoted from repeated incidents; raw logs are not treated as knowledge.';
comment on table public.reliability_regression_cases is 'Permanent regression-test proposals and implementation evidence derived from incidents.';
comment on table public.reliability_recovery_queue is 'Risk-gated recovery actions. High-risk actions always require approval.';

commit;
