-- Stage 7 safety follow-up for one-click unattended execution.
-- This patch is intentionally separate because migration 006 may already be applied.

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
  v_canary_only_complete boolean;
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
    and job.status in (
      'prepared','canary_dispatching','canary_running','canary_succeeded',
      'normal_running','retry_running','dispatch_uncertain','normal_succeeded'
    )
    and (
      job.automation_stop_reason is null
      or job.status = 'normal_succeeded'
      or (
        job.status = 'canary_succeeded'
        and not exists (
          select 1 from public.shopling_price_bulk_chunks normal_chunk
          where normal_chunk.job_id = job.id and normal_chunk.chunk_type = 'normal'
        )
      )
      or exists (
        select 1
        from public.shopling_price_bulk_chunks active_chunk
        where active_chunk.job_id = job.id
          and active_chunk.status in ('dispatching','running','dispatch_uncertain')
      )
    )
    and (
      not job.pause_requested
      or job.status in ('normal_running','retry_running','dispatch_uncertain')
    )
    and (job.automation_lease_until is null or job.automation_lease_until <= now())
  order by coalesce(job.automation_last_tick_at, job.created_at) asc, job.created_at asc
  limit 1
  for update skip locked;

  if v_job.id is null then
    return jsonb_build_object('claimed', false);
  end if;

  select v_job.status = 'canary_succeeded' and not exists (
    select 1 from public.shopling_price_bulk_chunks
    where job_id = v_job.id and chunk_type = 'normal'
  ) into v_canary_only_complete;

  -- Result rows are already committed. Recover only the missing automation marker
  -- without claiming or dispatching another external request.
  if v_job.status = 'normal_succeeded' or v_canary_only_complete then
    update public.shopling_price_bulk_jobs
    set automation_finished_at = coalesce(automation_finished_at, now()),
        automation_last_tick_at = now(),
        automation_lease_until = null,
        automation_worker_id = null,
        automation_stop_reason = null,
        updated_at = now()
    where id = v_job.id;

    return jsonb_build_object(
      'claimed', false,
      'recovered_terminal_job_id', v_job.id,
      'status', v_job.status,
      'finished', true
    );
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
    'lease_seconds', p_lease_seconds,
    'pause_requested', v_job.pause_requested,
    'has_stop_reason', v_job.automation_stop_reason is not null
  );
end;
$$;

create or replace function public.continue_shopling_price_bulk_auto_after_review(
  p_job_id uuid,
  p_owner_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.shopling_price_bulk_jobs;
  v_next_status text;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  select * into v_job
  from public.shopling_price_bulk_jobs
  where id = p_job_id and owner_id = p_owner_id
  for update;

  if v_job.id is null then raise exception 'job not found'; end if;
  if v_job.automation_mode <> 'auto' then raise exception 'auto job required'; end if;
  if v_job.execution_mode <> 'live' then raise exception 'validation-only job cannot continue'; end if;
  if v_job.archived_at is not null then raise exception 'archived job cannot continue'; end if;
  if v_job.automation_finished_at is not null then raise exception 'finished job cannot continue'; end if;
  if nullif(trim(coalesce(v_job.automation_stop_reason, '')), '') is null then raise exception 'stop reason required'; end if;
  if v_job.status not in ('canary_succeeded','normal_running','retry_running','normal_paused','retry_paused') then
    raise exception 'auto continuation not allowed for current status';
  end if;
  if exists (
    select 1 from public.shopling_price_bulk_chunks
    where job_id = p_job_id and status in ('dispatching','running','dispatch_uncertain')
  ) then raise exception 'active chunk exists'; end if;

  v_next_status := case v_job.status
    when 'normal_paused' then 'normal_running'
    when 'retry_paused' then 'retry_running'
    else v_job.status
  end;

  update public.shopling_price_bulk_jobs
  set status = v_next_status,
      pause_requested = false,
      automation_stop_reason = null,
      automation_finished_at = null,
      automation_last_tick_at = now(),
      automation_lease_until = null,
      automation_worker_id = null,
      updated_at = now()
  where id = p_job_id and owner_id = p_owner_id;

  return jsonb_build_object(
    'job_id', p_job_id,
    'status', v_next_status,
    'auto', true,
    'continued', true
  );
end;
$$;

-- Preserve the existing manual reset behavior. For an auto job, record the stop
-- reason in the same transaction so a process exit can never cause auto-retry.
create or replace function public.reset_shopling_price_bulk_canary_rejected(
  p_job_id uuid,
  p_owner_id uuid,
  p_request_id text,
  p_error text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.shopling_price_bulk_jobs;
  v_chunk_id uuid;
  v_reason text := left(coalesce(nullif(trim(p_error), ''), 'dispatch rejected'), 1000);
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  select * into v_job
  from public.shopling_price_bulk_jobs
  where id = p_job_id and owner_id = p_owner_id
  for update;
  if v_job.id is null then raise exception 'job not found'; end if;

  update public.shopling_price_bulk_chunks
  set status = 'pending',
      request_id = null,
      actions_url = null,
      started_at = null,
      updated_at = now(),
      last_error = v_reason
  where job_id = p_job_id
    and chunk_index = 0
    and chunk_type = 'canary'
    and status = 'dispatching'
    and request_id = p_request_id
  returning id into v_chunk_id;

  if v_chunk_id is null then raise exception 'invalid canary rejected transition'; end if;

  update public.shopling_price_bulk_jobs
  set status = 'prepared',
      last_error = v_reason,
      automation_stop_reason = case
        when v_job.automation_mode = 'auto'
          then left('첫 10개 실행 요청이 거절되어 자동 실행을 멈췄습니다. ' || v_reason, 500)
        else automation_stop_reason
      end,
      automation_last_tick_at = case
        when v_job.automation_mode = 'auto' then now()
        else automation_last_tick_at
      end,
      updated_at = now()
  where id = p_job_id and owner_id = p_owner_id;
end;
$$;

-- Optional direct transition retained for future callers that want reset, stop,
-- and lease release in one RPC.
create or replace function public.reject_shopling_price_bulk_canary_auto(
  p_job_id uuid,
  p_owner_id uuid,
  p_worker_id text,
  p_request_id text,
  p_error text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.shopling_price_bulk_jobs;
  v_chunk_id uuid;
  v_reason text := left(coalesce(nullif(trim(p_error), ''), 'canary dispatch rejected'), 1000);
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  select * into v_job
  from public.shopling_price_bulk_jobs
  where id = p_job_id and owner_id = p_owner_id
  for update;

  if v_job.id is null then raise exception 'job not found'; end if;
  if v_job.automation_mode <> 'auto' then raise exception 'auto job required'; end if;
  if v_job.automation_worker_id is distinct from p_worker_id then raise exception 'auto worker mismatch'; end if;
  if v_job.status <> 'canary_dispatching' then raise exception 'canary rejection transition not allowed'; end if;

  update public.shopling_price_bulk_chunks
  set status = 'pending',
      request_id = null,
      actions_url = null,
      started_at = null,
      updated_at = now(),
      last_error = v_reason
  where job_id = p_job_id
    and chunk_index = 0
    and chunk_type = 'canary'
    and status = 'dispatching'
    and request_id = p_request_id
  returning id into v_chunk_id;

  if v_chunk_id is null then raise exception 'canary rejection chunk not found'; end if;

  update public.shopling_price_bulk_jobs
  set status = 'prepared',
      automation_stop_reason = left('첫 10개 실행 요청이 거절되어 자동 실행을 멈췄습니다. ' || v_reason, 500),
      automation_last_tick_at = now(),
      automation_lease_until = null,
      automation_worker_id = null,
      last_error = v_reason,
      updated_at = now()
  where id = p_job_id and owner_id = p_owner_id;

  return jsonb_build_object(
    'job_id', p_job_id,
    'status', 'prepared',
    'stopped', true,
    'request_id', p_request_id
  );
end;
$$;

revoke all on function public.claim_next_shopling_price_bulk_auto_job(text,integer) from public, anon, authenticated;
revoke all on function public.continue_shopling_price_bulk_auto_after_review(uuid,uuid) from public, anon, authenticated;
revoke all on function public.reset_shopling_price_bulk_canary_rejected(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.reject_shopling_price_bulk_canary_auto(uuid,uuid,text,text,text) from public, anon, authenticated;

grant execute on function public.claim_next_shopling_price_bulk_auto_job(text,integer) to service_role;
grant execute on function public.continue_shopling_price_bulk_auto_after_review(uuid,uuid) to service_role;
grant execute on function public.reset_shopling_price_bulk_canary_rejected(uuid,uuid,text,text) to service_role;
grant execute on function public.reject_shopling_price_bulk_canary_auto(uuid,uuid,text,text,text) to service_role;
