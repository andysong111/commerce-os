begin;

create table if not exists public.reliability_learning_analysis_queue (
  id uuid primary key default gen_random_uuid(),
  learning_case_id uuid not null unique references public.reliability_learning_cases(id) on delete cascade,
  incident_id uuid not null references public.reliability_incidents(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','running','succeeded','failed','dead_letter','canceled')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  not_before timestamptz not null default now(),
  locked_at timestamptz,
  model text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reliability_learning_analysis_ready_idx
  on public.reliability_learning_analysis_queue(status, not_before, created_at)
  where status in ('pending','failed');
create index if not exists reliability_learning_analysis_incident_idx
  on public.reliability_learning_analysis_queue(incident_id, updated_at desc);

drop trigger if exists reliability_learning_analysis_queue_set_updated_at
  on public.reliability_learning_analysis_queue;
create trigger reliability_learning_analysis_queue_set_updated_at
before update on public.reliability_learning_analysis_queue
for each row execute function public.set_reliability_updated_at();

create or replace function public.enqueue_reliability_learning_analysis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.state = 'candidate'
     and (nullif(new.root_cause, '') is null
       or nullif(new.resolution, '') is null
       or nullif(new.prevention_rule, '') is null) then
    insert into public.reliability_learning_analysis_queue(
      learning_case_id, incident_id, status
    ) values (
      new.id, new.incident_id, 'pending'
    )
    on conflict (learning_case_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists enqueue_reliability_learning_analysis
  on public.reliability_learning_cases;
create trigger enqueue_reliability_learning_analysis
after insert or update of state, root_cause, resolution, prevention_rule
on public.reliability_learning_cases
for each row execute function public.enqueue_reliability_learning_analysis();

insert into public.reliability_learning_analysis_queue(
  learning_case_id, incident_id, status
)
select l.id, l.incident_id, 'pending'
from public.reliability_learning_cases l
where l.state = 'candidate'
  and (
    nullif(l.root_cause, '') is null
    or nullif(l.resolution, '') is null
    or nullif(l.prevention_rule, '') is null
  )
on conflict (learning_case_id) do nothing;

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
    where q.status in ('pending','failed')
      and q.not_before <= now()
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

create or replace function public.complete_reliability_learning_analysis(
  p_job_id uuid,
  p_model text,
  p_analysis jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_learning_case_id uuid;
  v_incident_id uuid;
  v_confidence numeric;
begin
  select learning_case_id, incident_id
  into v_learning_case_id, v_incident_id
  from public.reliability_learning_analysis_queue
  where id = p_job_id and status = 'running'
  for update;

  if v_learning_case_id is null then
    return false;
  end if;

  if nullif(btrim(p_analysis->>'root_cause'), '') is null
     or nullif(btrim(p_analysis->>'resolution'), '') is null
     or nullif(btrim(p_analysis->>'prevention_rule'), '') is null then
    raise exception 'root_cause, resolution and prevention_rule are required';
  end if;

  v_confidence := greatest(
    0,
    least(1, coalesce(nullif(p_analysis->>'confidence', '')::numeric, 0))
  );

  update public.reliability_learning_cases
  set root_cause = left(btrim(p_analysis->>'root_cause'), 4000),
      resolution = left(btrim(p_analysis->>'resolution'), 4000),
      prevention_rule = left(btrim(p_analysis->>'prevention_rule'), 4000),
      confidence = v_confidence,
      evidence = evidence || jsonb_build_object(
        'aiAnalysis', p_analysis,
        'analysisModel', left(coalesce(p_model, ''), 160),
        'analyzedAt', now()
      ),
      updated_at = now()
  where id = v_learning_case_id;

  update public.reliability_regression_cases
  set test_name = coalesce(
        nullif(left(btrim(p_analysis->>'regression_test_title'), 300), ''),
        test_name
      ),
      protected_invariant = coalesce(
        nullif(left(btrim(p_analysis->>'protected_invariant'), 2000), ''),
        protected_invariant
      ),
      evidence = evidence || jsonb_build_object(
        'aiAnalysisJobId', p_job_id,
        'analysisModel', left(coalesce(p_model, ''), 160),
        'safeAutomaticAction', coalesce(nullif(p_analysis->>'safe_automatic_action', ''), 'none')
      ),
      updated_at = now()
  where incident_id = v_incident_id
    and status = 'proposed';

  update public.reliability_learning_analysis_queue
  set status = 'succeeded',
      model = left(coalesce(p_model, ''), 160),
      last_error = null,
      updated_at = now()
  where id = p_job_id;

  return true;
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
      last_error = left(coalesce(p_error, 'unknown analysis failure'), 2000),
      updated_at = now()
  where id = p_job_id;

  return true;
end;
$$;

alter table public.reliability_learning_analysis_queue enable row level security;

comment on table public.reliability_learning_analysis_queue is 'Durable queue for privacy-minimized OpenAI analysis of repeated reliability incidents.';
comment on function public.claim_reliability_learning_analysis(integer) is 'Claims a small batch of repeated incidents with only sanitized operational evidence.';
comment on function public.complete_reliability_learning_analysis(uuid,text,jsonb) is 'Stores AI root-cause, resolution and prevention analysis without auto-approving or auto-merging code changes.';

commit;
