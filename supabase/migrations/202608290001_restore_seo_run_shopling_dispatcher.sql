-- Restore the durable Shopling registration consumer after legacy Supabase HTTP
-- cron fanout was retired. Vercel keeps one scheduler heartbeat; this task is
-- claimed through the shared adaptive dispatcher and protected by its own lease.

create table if not exists public.seo_run_shopling_worker_control (
  singleton boolean primary key default true check (singleton),
  lease_owner text,
  lease_until timestamptz,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_result jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.seo_run_shopling_worker_control(singleton)
values (true)
on conflict (singleton) do nothing;

alter table public.seo_run_shopling_worker_control enable row level security;
revoke all on table public.seo_run_shopling_worker_control
  from public, anon, authenticated;
grant select, update on table public.seo_run_shopling_worker_control
  to service_role;

create or replace function public.claim_seo_run_shopling_worker_pulse(
  p_worker_id text,
  p_lease_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.seo_run_shopling_worker_control;
begin
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9._:-]{1,160}$' then
    raise exception 'invalid worker id';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 300 then
    raise exception 'pulse lease seconds must be between 30 and 300';
  end if;

  update public.seo_run_shopling_worker_control
  set lease_owner = p_worker_id,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      last_started_at = now(),
      updated_at = now()
  where singleton = true
    and (lease_until is null or lease_until <= now())
  returning * into v_row;

  if v_row.singleton is null then
    return jsonb_build_object('claimed', false);
  end if;

  return jsonb_build_object(
    'claimed', true,
    'lease_owner', v_row.lease_owner,
    'lease_until', v_row.lease_until
  );
end;
$$;

create or replace function public.finish_seo_run_shopling_worker_pulse(
  p_worker_id text,
  p_result jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_finished boolean := false;
begin
  update public.seo_run_shopling_worker_control
  set lease_owner = null,
      lease_until = null,
      last_finished_at = now(),
      last_result = coalesce(p_result, '{}'::jsonb),
      updated_at = now()
  where singleton = true
    and lease_owner = p_worker_id
  returning true into v_finished;

  return jsonb_build_object('finished', coalesce(v_finished, false));
end;
$$;

revoke all on function public.claim_seo_run_shopling_worker_pulse(text, integer)
  from public, anon, authenticated;
revoke all on function public.finish_seo_run_shopling_worker_pulse(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_seo_run_shopling_worker_pulse(text, integer)
  to service_role;
grant execute on function public.finish_seo_run_shopling_worker_pulse(text, jsonb)
  to service_role;

insert into public.ops_dispatch_tasks (
  task_key, route_path, workload_class, priority, enabled,
  normal_interval_seconds, busy_interval_seconds,
  recovery_interval_seconds, timeout_seconds, next_run_at
)
values (
  'seo-run-shopling-worker',
  '/api/cron/seo-run-shopling-worker',
  'critical',
  5,
  true,
  300,
  60,
  300,
  180,
  now()
)
on conflict (task_key) do update
set route_path = excluded.route_path,
    workload_class = excluded.workload_class,
    priority = excluded.priority,
    enabled = excluded.enabled,
    normal_interval_seconds = excluded.normal_interval_seconds,
    busy_interval_seconds = excluded.busy_interval_seconds,
    recovery_interval_seconds = excluded.recovery_interval_seconds,
    timeout_seconds = excluded.timeout_seconds,
    next_run_at = least(public.ops_dispatch_tasks.next_run_at, now()),
    updated_at = now();

comment on table public.seo_run_shopling_worker_control is
  'Independent lease for durable Shopling registration and postprocess work. Scheduling remains owned by the single Vercel adaptive dispatcher.';
