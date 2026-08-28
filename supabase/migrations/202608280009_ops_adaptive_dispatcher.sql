-- Long-term OPS scheduler: one Vercel heartbeat claims at most one bounded task.
-- This replaces independent cron fan-out with DB-backed priority, backpressure,
-- global recovery mode and per-task leases. The tables retain only current state,
-- not an ever-growing execution history.

create table if not exists public.ops_dispatch_state (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'normal' check (mode in ('normal', 'recovery')),
  recovery_until timestamptz,
  lease_owner text,
  lease_until timestamptz,
  consecutive_database_failures integer not null default 0
    check (consecutive_database_failures >= 0),
  last_task_key text,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_error text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.ops_dispatch_state(singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.ops_dispatch_tasks (
  task_key text primary key check (task_key ~ '^[a-z0-9][a-z0-9._-]{1,119}$'),
  route_path text not null check (route_path like '/api/cron/%'),
  workload_class text not null
    check (workload_class in ('critical', 'operational', 'diagnostic', 'maintenance')),
  priority smallint not null default 100 check (priority between 1 and 1000),
  enabled boolean not null default true,
  normal_interval_seconds integer not null
    check (normal_interval_seconds between 60 and 2592000),
  busy_interval_seconds integer not null
    check (busy_interval_seconds between 60 and 2592000),
  recovery_interval_seconds integer not null
    check (recovery_interval_seconds between 60 and 2592000),
  timeout_seconds integer not null default 240 check (timeout_seconds between 15 and 300),
  next_run_at timestamptz not null default now(),
  lease_owner text,
  lease_until timestamptz,
  last_status text not null default 'never'
    check (last_status in ('never', 'success', 'busy', 'failure', 'skipped')),
  last_http_status integer,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_result jsonb not null default '{}'::jsonb,
  last_error text not null default '',
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  run_count bigint not null default 0 check (run_count >= 0),
  success_count bigint not null default 0 check (success_count >= 0),
  failure_count bigint not null default 0 check (failure_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ops_dispatch_tasks_due_idx
  on public.ops_dispatch_tasks (enabled, next_run_at, priority, task_key)
  where lease_until is null or lease_until <= now();

-- The partial predicate above cannot contain volatile expressions on every
-- Postgres build. Keep a stable due-order index as the guaranteed planner path.
drop index if exists public.ops_dispatch_tasks_due_idx;
create index if not exists ops_dispatch_tasks_due_idx
  on public.ops_dispatch_tasks (enabled, next_run_at, priority, task_key);

create index if not exists ops_dispatch_tasks_lease_idx
  on public.ops_dispatch_tasks (lease_until)
  where lease_until is not null;

alter table public.ops_dispatch_state enable row level security;
alter table public.ops_dispatch_tasks enable row level security;
revoke all on table public.ops_dispatch_state from public, anon, authenticated;
revoke all on table public.ops_dispatch_tasks from public, anon, authenticated;
grant select, insert, update, delete on table public.ops_dispatch_state to service_role;
grant select, insert, update, delete on table public.ops_dispatch_tasks to service_role;

insert into public.ops_dispatch_tasks (
  task_key,
  route_path,
  workload_class,
  priority,
  enabled,
  normal_interval_seconds,
  busy_interval_seconds,
  recovery_interval_seconds,
  timeout_seconds,
  next_run_at
)
values
  ('seo-run-worker', '/api/cron/seo-run-worker', 'critical', 10, true, 300, 60, 300, 280, now()),
  ('detail-page-jobs', '/api/cron/detail-page-jobs', 'critical', 20, true, 300, 60, 600, 50, now() + interval '1 minute'),
  ('shopling-price-bulk-auto', '/api/cron/shopling-price-bulk-auto', 'critical', 30, true, 900, 60, 1800, 50, now() + interval '2 minutes'),
  ('product-decision-live-refresh', '/api/cron/product-decision-live-refresh', 'operational', 110, true, 3600, 300, 21600, 280, now() + interval '3 minutes'),
  ('product-master-shopling-sales-incremental', '/api/cron/product-master-shopling-sales-incremental', 'operational', 120, true, 3600, 300, 21600, 280, now() + interval '4 minutes'),
  ('product-master-shopling-sales-events', '/api/cron/product-master-shopling-sales-events', 'operational', 130, true, 3600, 300, 21600, 280, now() + interval '5 minutes'),
  ('receipt-live-price-proposals', '/api/cron/receipt-live-price-proposals', 'operational', 140, true, 3600, 300, 21600, 280, now() + interval '6 minutes'),
  ('price-grade-receipt-shadow-bootstrap', '/api/cron/price-grade-receipt-shadow-bootstrap', 'operational', 150, true, 3600, 300, 21600, 120, now() + interval '7 minutes'),
  ('stage8-canonical-sales-event-incremental-shadow', '/api/cron/stage8-canonical-sales-event-incremental-shadow', 'diagnostic', 210, true, 3600, 600, 21600, 280, now() + interval '8 minutes'),
  ('product-master-shopling-diagnostic', '/api/cron/product-master-shopling-diagnostic', 'diagnostic', 220, true, 21600, 1800, 43200, 280, now() + interval '9 minutes'),
  ('product-master-shopling-sales-backfill', '/api/cron/product-master-shopling-sales-backfill', 'diagnostic', 230, true, 21600, 1800, 43200, 280, now() + interval '10 minutes'),
  ('stage8-canonical-demand-parity', '/api/cron/stage8-canonical-demand-parity', 'diagnostic', 240, true, 21600, 1800, 43200, 280, now() + interval '11 minutes'),
  ('stage8-canonical-event-mismatch-evidence', '/api/cron/stage8-canonical-event-mismatch-evidence', 'diagnostic', 250, true, 21600, 1800, 43200, 280, now() + interval '12 minutes'),
  ('receipt-live-price-canary-preflight', '/api/cron/receipt-live-price-canary-preflight', 'diagnostic', 260, true, 21600, 1800, 43200, 280, now() + interval '13 minutes'),
  ('stage8-canonical-sales-event-full-audit', '/api/cron/stage8-canonical-sales-event-full-audit', 'diagnostic', 270, true, 86400, 3600, 86400, 280, now() + interval '14 minutes'),
  ('ops-storage-maintenance', '/api/cron/ops-storage-maintenance', 'maintenance', 900, true, 21600, 1800, 86400, 120, now() + interval '15 minutes')
on conflict (task_key) do update
set route_path = excluded.route_path,
    workload_class = excluded.workload_class,
    priority = excluded.priority,
    enabled = excluded.enabled,
    normal_interval_seconds = excluded.normal_interval_seconds,
    busy_interval_seconds = excluded.busy_interval_seconds,
    recovery_interval_seconds = excluded.recovery_interval_seconds,
    timeout_seconds = excluded.timeout_seconds,
    updated_at = now();

create or replace function public.claim_next_ops_dispatch_task(
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_now timestamptz := now();
  v_state public.ops_dispatch_state;
  v_task public.ops_dispatch_tasks;
begin
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9._:-]{1,160}$' then
    raise exception 'invalid dispatcher worker id';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 300 then
    raise exception 'dispatcher lease seconds must be between 30 and 300';
  end if;

  insert into public.ops_dispatch_state(singleton)
  values (true)
  on conflict (singleton) do nothing;

  select * into v_state
  from public.ops_dispatch_state
  where singleton = true
  for update;

  if v_state.lease_until is not null and v_state.lease_until > v_now then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'global_lease_active',
      'lease_until', v_state.lease_until,
      'mode', v_state.mode
    );
  end if;

  if v_state.mode = 'recovery'
     and (v_state.recovery_until is null or v_state.recovery_until <= v_now) then
    update public.ops_dispatch_state
    set mode = 'normal',
        recovery_until = null,
        consecutive_database_failures = 0,
        updated_at = v_now
    where singleton = true;
    v_state.mode := 'normal';
    v_state.recovery_until := null;
  end if;

  select * into v_task
  from public.ops_dispatch_tasks task
  where task.enabled = true
    and task.next_run_at <= v_now
    and (task.lease_until is null or task.lease_until <= v_now)
    and (v_state.mode <> 'recovery' or task.workload_class = 'critical')
  order by task.priority asc, task.next_run_at asc, task.task_key asc
  limit 1
  for update of task skip locked;

  if v_task.task_key is null then
    return jsonb_build_object(
      'claimed', false,
      'reason', case when v_state.mode = 'recovery' then 'recovery_no_critical_due' else 'no_task_due' end,
      'mode', v_state.mode,
      'recovery_until', v_state.recovery_until,
      'next_due_at', (
        select min(next_run_at)
        from public.ops_dispatch_tasks
        where enabled = true
          and (v_state.mode <> 'recovery' or workload_class = 'critical')
      )
    );
  end if;

  update public.ops_dispatch_tasks
  set lease_owner = p_worker_id,
      lease_until = v_now + make_interval(secs => p_lease_seconds),
      last_started_at = v_now,
      run_count = run_count + 1,
      updated_at = v_now
  where task_key = v_task.task_key;

  update public.ops_dispatch_state
  set lease_owner = p_worker_id,
      lease_until = v_now + make_interval(secs => p_lease_seconds),
      last_task_key = v_task.task_key,
      last_started_at = v_now,
      last_error = '',
      updated_at = v_now
  where singleton = true;

  return jsonb_build_object(
    'claimed', true,
    'mode', v_state.mode,
    'recovery_until', v_state.recovery_until,
    'task', jsonb_build_object(
      'task_key', v_task.task_key,
      'route_path', v_task.route_path,
      'workload_class', v_task.workload_class,
      'priority', v_task.priority,
      'timeout_seconds', v_task.timeout_seconds,
      'normal_interval_seconds', v_task.normal_interval_seconds,
      'busy_interval_seconds', v_task.busy_interval_seconds,
      'recovery_interval_seconds', v_task.recovery_interval_seconds
    )
  );
end;
$function$;

create or replace function public.finish_ops_dispatch_task(
  p_worker_id text,
  p_task_key text,
  p_outcome text,
  p_http_status integer default null,
  p_busy boolean default false,
  p_database_pressure boolean default false,
  p_result jsonb default '{}'::jsonb,
  p_error text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_now timestamptz := now();
  v_state public.ops_dispatch_state;
  v_task public.ops_dispatch_tasks;
  v_failures integer;
  v_interval_seconds integer;
  v_status text;
  v_recovery_until timestamptz;
begin
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9._:-]{1,160}$' then
    raise exception 'invalid dispatcher worker id';
  end if;
  if p_task_key is null or p_task_key !~ '^[a-z0-9][a-z0-9._-]{1,119}$' then
    raise exception 'invalid dispatcher task key';
  end if;
  if p_outcome not in ('success', 'failure', 'skipped') then
    raise exception 'invalid dispatcher outcome';
  end if;

  select * into v_state
  from public.ops_dispatch_state
  where singleton = true
  for update;

  select * into v_task
  from public.ops_dispatch_tasks
  where task_key = p_task_key
  for update;

  if v_task.task_key is null
     or v_task.lease_owner is distinct from p_worker_id
     or v_state.lease_owner is distinct from p_worker_id then
    return jsonb_build_object('finished', false, 'reason', 'lease_lost');
  end if;

  if p_outcome = 'success' then
    v_failures := 0;
    v_interval_seconds := case
      when p_busy then v_task.busy_interval_seconds
      else v_task.normal_interval_seconds
    end;
    v_status := case when p_busy then 'busy' else 'success' end;
  elsif p_outcome = 'skipped' then
    v_failures := 0;
    v_interval_seconds := v_task.normal_interval_seconds;
    v_status := 'skipped';
  else
    v_failures := v_task.consecutive_failures + 1;
    v_interval_seconds := least(
      86400,
      greatest(
        v_task.busy_interval_seconds,
        round(
          v_task.recovery_interval_seconds
          * power(2::numeric, least(v_failures - 1, 4))
        )::integer
      )
    );
    v_status := 'failure';
  end if;

  update public.ops_dispatch_tasks
  set next_run_at = v_now + make_interval(secs => v_interval_seconds),
      lease_owner = null,
      lease_until = null,
      last_status = v_status,
      last_http_status = p_http_status,
      last_finished_at = v_now,
      last_result = coalesce(p_result, '{}'::jsonb),
      last_error = left(coalesce(p_error, ''), 2000),
      consecutive_failures = v_failures,
      success_count = success_count + case when p_outcome in ('success', 'skipped') then 1 else 0 end,
      failure_count = failure_count + case when p_outcome = 'failure' then 1 else 0 end,
      updated_at = v_now
  where task_key = p_task_key;

  if p_database_pressure then
    v_recovery_until := greatest(
      coalesce(v_state.recovery_until, v_now),
      v_now + interval '15 minutes'
    );
    update public.ops_dispatch_state
    set mode = 'recovery',
        recovery_until = v_recovery_until,
        consecutive_database_failures = consecutive_database_failures + 1,
        lease_owner = null,
        lease_until = null,
        last_finished_at = v_now,
        last_error = left(coalesce(p_error, ''), 2000),
        updated_at = v_now
    where singleton = true;
  else
    update public.ops_dispatch_state
    set mode = case
          when mode = 'recovery' and recovery_until is not null and recovery_until > v_now
            then 'recovery'
          else 'normal'
        end,
        recovery_until = case
          when mode = 'recovery' and recovery_until is not null and recovery_until > v_now
            then recovery_until
          else null
        end,
        consecutive_database_failures = case
          when mode = 'recovery' and recovery_until is not null and recovery_until > v_now
            then consecutive_database_failures
          else 0
        end,
        lease_owner = null,
        lease_until = null,
        last_finished_at = v_now,
        last_error = left(coalesce(p_error, ''), 2000),
        updated_at = v_now
    where singleton = true;
  end if;

  return jsonb_build_object(
    'finished', true,
    'task_key', p_task_key,
    'status', v_status,
    'next_run_at', v_now + make_interval(secs => v_interval_seconds),
    'mode', case when p_database_pressure then 'recovery' else null end,
    'recovery_until', v_recovery_until
  );
end;
$function$;

create or replace function public.wake_ops_dispatch_task(
  p_task_key text,
  p_delay_seconds integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_next_run_at timestamptz;
begin
  if p_task_key is null or p_task_key !~ '^[a-z0-9][a-z0-9._-]{1,119}$' then
    raise exception 'invalid dispatcher task key';
  end if;
  if p_delay_seconds < 0 or p_delay_seconds > 86400 then
    raise exception 'dispatcher wake delay must be between 0 and 86400 seconds';
  end if;

  update public.ops_dispatch_tasks
  set next_run_at = least(next_run_at, now() + make_interval(secs => p_delay_seconds)),
      updated_at = now()
  where task_key = p_task_key
    and enabled = true
  returning next_run_at into v_next_run_at;

  return jsonb_build_object(
    'woken', v_next_run_at is not null,
    'task_key', p_task_key,
    'next_run_at', v_next_run_at
  );
end;
$function$;

revoke all on function public.claim_next_ops_dispatch_task(text, integer)
  from public, anon, authenticated;
revoke all on function public.finish_ops_dispatch_task(text, text, text, integer, boolean, boolean, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.wake_ops_dispatch_task(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_next_ops_dispatch_task(text, integer) to service_role;
grant execute on function public.finish_ops_dispatch_task(text, text, text, integer, boolean, boolean, jsonb, text) to service_role;
grant execute on function public.wake_ops_dispatch_task(text, integer) to service_role;

comment on table public.ops_dispatch_tasks is
  'Bounded adaptive scheduler catalog. One task is claimed per Vercel heartbeat; no per-run history is accumulated here.';
comment on table public.ops_dispatch_state is
  'Global OPS dispatcher lease and database-pressure circuit breaker.';
