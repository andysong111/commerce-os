-- Stage 7: simple one-click auto execution with bounded server leases.
-- Apply manually only after PR review, tests, Preview verification, and CRON_SECRET setup.

alter table public.shopling_price_bulk_jobs
  add column if not exists automation_mode text not null default 'manual',
  add column if not exists automation_started_at timestamptz,
  add column if not exists automation_last_tick_at timestamptz,
  add column if not exists automation_finished_at timestamptz,
  add column if not exists automation_lease_until timestamptz,
  add column if not exists automation_worker_id text,
  add column if not exists automation_stop_reason text;

alter table public.shopling_price_bulk_jobs
  drop constraint if exists shopling_price_bulk_jobs_automation_mode_check;
alter table public.shopling_price_bulk_jobs
  add constraint shopling_price_bulk_jobs_automation_mode_check
  check (automation_mode in ('manual','auto'));

alter table public.shopling_price_bulk_jobs
  drop constraint if exists shopling_price_bulk_jobs_validation_auto_check;
alter table public.shopling_price_bulk_jobs
  add constraint shopling_price_bulk_jobs_validation_auto_check
  check (execution_mode <> 'validation_only' or automation_mode = 'manual');

create index if not exists shopling_price_bulk_jobs_auto_claim
  on public.shopling_price_bulk_jobs(
    automation_mode,
    archived_at,
    automation_lease_until,
    automation_last_tick_at,
    created_at
  );

create or replace function public.enable_shopling_price_bulk_auto_execution(
  p_job_id uuid,
  p_owner_id uuid,
  p_worker_id text,
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.shopling_price_bulk_jobs;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9._:-]{1,120}$' then raise exception 'invalid worker id'; end if;
  if p_lease_seconds < 15 or p_lease_seconds > 120 then raise exception 'lease seconds must be between 15 and 120'; end if;

  select * into v_job
  from public.shopling_price_bulk_jobs
  where id = p_job_id and owner_id = p_owner_id
  for update;

  if v_job.id is null then raise exception 'job not found'; end if;
  if v_job.execution_mode <> 'live' then raise exception 'validation-only job cannot use auto execution'; end if;
  if v_job.status <> 'prepared' then raise exception 'auto execution requires prepared job'; end if;
  if v_job.archived_at is not null then raise exception 'archived job cannot use auto execution'; end if;
  if v_job.pause_requested then raise exception 'paused job cannot use auto execution'; end if;
  if exists (
    select 1 from public.shopling_price_bulk_chunks
    where job_id = p_job_id and status in ('dispatching','running','dispatch_uncertain')
  ) then raise exception 'active chunk exists'; end if;

  update public.shopling_price_bulk_jobs
  set automation_mode = 'auto',
      automation_started_at = coalesce(automation_started_at, now()),
      automation_last_tick_at = now(),
      automation_finished_at = null,
      automation_lease_until = now() + make_interval(secs => p_lease_seconds),
      automation_worker_id = p_worker_id,
      automation_stop_reason = null,
      updated_at = now()
  where id = p_job_id and owner_id = p_owner_id;

  return jsonb_build_object(
    'job_id', p_job_id,
    'owner_id', p_owner_id,
    'status', 'prepared',
    'automation_mode', 'auto',
    'worker_id', p_worker_id,
    'lease_seconds', p_lease_seconds
  );
end;
$$;

create or replace function public.claim_next_shopling_price_bulk_auto_job(
  p_worker_id text,
  p_lease_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.shopling_price_bulk_jobs;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9._:-]{1,120}$' then raise exception 'invalid worker id'; end if;
  if p_lease_seconds < 15 or p_lease_seconds > 120 then raise exception 'lease seconds must be between 15 and 120'; end if;

  select * into v_job
  from public.shopling_price_bulk_jobs job
  where job.automation_mode = 'auto'
    and job.execution_mode = 'live'
    and job.archived_at is null
    and job.automation_finished_at is null
    and job.automation_stop_reason is null
    and not job.pause_requested
    and job.status in (
      'prepared','canary_dispatching','canary_running','canary_succeeded',
      'normal_running','retry_running','dispatch_uncertain'
    )
    and (job.automation_lease_until is null or job.automation_lease_until <= now())
  order by coalesce(job.automation_last_tick_at, job.created_at) asc, job.created_at asc
  limit 1
  for update skip locked;

  if v_job.id is null then
    return jsonb_build_object('claimed', false);
  end if;

  update public.shopling_price_bulk_jobs
  set automation_worker_id = p_worker_id,
      automation_lease_until = now() + make_interval(secs => p_lease_seconds),
      automation_last_tick_at = now(),
      updated_at = now()
  where id = v_job.id;

  return jsonb_build_object(
    'claimed', true,
    'job_id', v_job.id,
    'owner_id', v_job.owner_id,
    'status', v_job.status,
    'worker_id', p_worker_id,
    'lease_seconds', p_lease_seconds
  );
end;
$$;

create or replace function public.release_shopling_price_bulk_auto_job(
  p_job_id uuid,
  p_worker_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  update public.shopling_price_bulk_jobs
  set automation_worker_id = null,
      automation_lease_until = null,
      automation_last_tick_at = now(),
      updated_at = now()
  where id = p_job_id
    and automation_mode = 'auto'
    and automation_worker_id = p_worker_id
  returning status into v_status;

  if v_status is null then raise exception 'auto lease release rejected'; end if;
  return jsonb_build_object('job_id', p_job_id, 'status', v_status, 'released', true);
end;
$$;

create or replace function public.finish_shopling_price_bulk_auto_job(
  p_job_id uuid,
  p_owner_id uuid,
  p_worker_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.shopling_price_bulk_jobs;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  select * into v_job
  from public.shopling_price_bulk_jobs
  where id = p_job_id and owner_id = p_owner_id
  for update;

  if v_job.id is null then raise exception 'job not found'; end if;
  if v_job.automation_mode <> 'auto' then raise exception 'job is not auto mode'; end if;
  if v_job.automation_worker_id <> p_worker_id then raise exception 'auto worker mismatch'; end if;
  if v_job.status = 'normal_succeeded' then null;
  elsif v_job.status = 'canary_succeeded' and not exists (
    select 1 from public.shopling_price_bulk_chunks
    where job_id = p_job_id and chunk_type = 'normal'
  ) then null;
  else raise exception 'auto job is not complete';
  end if;

  update public.shopling_price_bulk_jobs
  set automation_finished_at = coalesce(automation_finished_at, now()),
      automation_last_tick_at = now(),
      automation_lease_until = null,
      automation_worker_id = null,
      automation_stop_reason = null,
      updated_at = now()
  where id = p_job_id and owner_id = p_owner_id;

  return jsonb_build_object('job_id', p_job_id, 'status', v_job.status, 'finished', true);
end;
$$;

create or replace function public.stop_shopling_price_bulk_auto_job(
  p_job_id uuid,
  p_owner_id uuid,
  p_worker_id text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  update public.shopling_price_bulk_jobs
  set automation_stop_reason = left(coalesce(nullif(trim(p_reason), ''), 'auto execution stopped'), 500),
      automation_last_tick_at = now(),
      automation_lease_until = null,
      automation_worker_id = null,
      updated_at = now()
  where id = p_job_id
    and owner_id = p_owner_id
    and automation_mode = 'auto'
    and automation_worker_id = p_worker_id
  returning status into v_status;

  if v_status is null then raise exception 'auto stop rejected'; end if;
  return jsonb_build_object('job_id', p_job_id, 'status', v_status, 'stopped', true);
end;
$$;

create or replace function public.resume_shopling_price_bulk_auto_execution(
  p_job_id uuid,
  p_owner_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.shopling_price_bulk_jobs;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  select * into v_job
  from public.shopling_price_bulk_jobs
  where id = p_job_id and owner_id = p_owner_id
  for update;

  if v_job.id is null then raise exception 'job not found'; end if;
  if v_job.automation_mode = 'manual' then
    return jsonb_build_object('job_id', p_job_id, 'auto', false, 'resumed', false, 'status', v_job.status);
  end if;
  if v_job.execution_mode <> 'live' then raise exception 'validation-only job cannot resume auto execution'; end if;
  if v_job.archived_at is not null then raise exception 'archived job cannot resume auto execution'; end if;
  if v_job.pause_requested then raise exception 'paused job cannot resume auto execution'; end if;
  if v_job.status not in ('retry_running','normal_running','canary_succeeded') then
    raise exception 'auto execution resume not allowed for current status';
  end if;

  update public.shopling_price_bulk_jobs
  set automation_stop_reason = null,
      automation_finished_at = null,
      automation_last_tick_at = now(),
      automation_lease_until = null,
      automation_worker_id = null,
      updated_at = now()
  where id = p_job_id and owner_id = p_owner_id;

  return jsonb_build_object('job_id', p_job_id, 'auto', true, 'resumed', true, 'status', v_job.status);
end;
$$;

create or replace function public.log_shopling_price_bulk_auto_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.automation_mode is distinct from old.automation_mode then
    insert into public.shopling_price_bulk_audit_events(
      job_id, owner_id, entity_type, entity_id, event_type, old_status, new_status, metadata
    ) values (
      new.id, new.owner_id, 'job', new.id::text, 'automation_mode_changed', old.status, new.status,
      jsonb_build_object('automation_mode', new.automation_mode)
    );
  end if;

  if new.automation_finished_at is distinct from old.automation_finished_at and new.automation_finished_at is not null then
    insert into public.shopling_price_bulk_audit_events(
      job_id, owner_id, entity_type, entity_id, event_type, old_status, new_status, metadata
    ) values (
      new.id, new.owner_id, 'job', new.id::text, 'automation_finished', old.status, new.status,
      jsonb_build_object('finished', true)
    );
  end if;

  if new.automation_stop_reason is distinct from old.automation_stop_reason and new.automation_stop_reason is not null then
    insert into public.shopling_price_bulk_audit_events(
      job_id, owner_id, entity_type, entity_id, event_type, old_status, new_status, metadata
    ) values (
      new.id, new.owner_id, 'job', new.id::text, 'automation_stopped', old.status, new.status,
      jsonb_build_object('has_reason', true)
    );
  end if;

  if new.automation_stop_reason is distinct from old.automation_stop_reason and new.automation_stop_reason is null and old.automation_stop_reason is not null then
    insert into public.shopling_price_bulk_audit_events(
      job_id, owner_id, entity_type, entity_id, event_type, old_status, new_status, metadata
    ) values (
      new.id, new.owner_id, 'job', new.id::text, 'automation_resumed', old.status, new.status,
      jsonb_build_object('resumed', true)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists shopling_price_bulk_auto_audit_trigger on public.shopling_price_bulk_jobs;
create trigger shopling_price_bulk_auto_audit_trigger
after update of automation_mode, automation_finished_at, automation_stop_reason
on public.shopling_price_bulk_jobs
for each row execute function public.log_shopling_price_bulk_auto_audit();

revoke all on function public.enable_shopling_price_bulk_auto_execution(uuid,uuid,text,integer) from public, anon, authenticated;
revoke all on function public.claim_next_shopling_price_bulk_auto_job(text,integer) from public, anon, authenticated;
revoke all on function public.release_shopling_price_bulk_auto_job(uuid,text) from public, anon, authenticated;
revoke all on function public.finish_shopling_price_bulk_auto_job(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.stop_shopling_price_bulk_auto_job(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.resume_shopling_price_bulk_auto_execution(uuid,uuid) from public, anon, authenticated;
revoke all on function public.log_shopling_price_bulk_auto_audit() from public, anon, authenticated;

grant execute on function public.enable_shopling_price_bulk_auto_execution(uuid,uuid,text,integer) to service_role;
grant execute on function public.claim_next_shopling_price_bulk_auto_job(text,integer) to service_role;
grant execute on function public.release_shopling_price_bulk_auto_job(uuid,text) to service_role;
grant execute on function public.finish_shopling_price_bulk_auto_job(uuid,uuid,text) to service_role;
grant execute on function public.stop_shopling_price_bulk_auto_job(uuid,uuid,text,text) to service_role;
grant execute on function public.resume_shopling_price_bulk_auto_execution(uuid,uuid) to service_role;