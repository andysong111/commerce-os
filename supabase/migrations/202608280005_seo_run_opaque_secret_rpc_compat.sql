-- Opaque sb_secret_ server keys are not JWTs. PostgREST still authorizes them as
-- the service_role database role, but request.jwt.claim.role may be absent.
-- These RPCs are already EXECUTE-revoked from public/anon/authenticated, so rely
-- on database function privileges instead of a redundant JWT-claim check.

create or replace function public.claim_next_seo_run_job(
  p_worker_id text,
  p_lease_seconds integer default 420
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.seo_run_jobs;
begin
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9._:-]{1,120}$' then
    raise exception 'invalid worker id';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 900 then
    raise exception 'lease seconds must be between 60 and 900';
  end if;

  select job.* into v_job
  from public.seo_run_jobs job
  where job.archived_at is null
    and job.status in ('queued','running')
    and job.not_before <= now()
    and job.attempt_count < job.max_attempts
    and (
      job.status = 'queued'
      or job.lease_until is null
      or job.lease_until <= now()
    )
    and not exists (
      select 1
      from public.seo_run_jobs active
      where active.owner_id = job.owner_id
        and active.launch_item_id = job.launch_item_id
        and active.run_id <> job.run_id
        and active.archived_at is null
        and active.status = 'running'
        and active.lease_until > now()
    )
  order by job.not_before asc, job.run_created_at asc, job.created_at asc
  limit 1
  for update skip locked;

  if v_job.run_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  update public.seo_run_jobs
  set status = 'running',
      lease_owner = p_worker_id,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(started_at, now()),
      error_message = '',
      updated_at = now()
  where run_id = v_job.run_id
  returning * into v_job;

  return jsonb_build_object('claimed', true, 'job', to_jsonb(v_job));
end;
$$;

revoke all on function public.claim_next_seo_run_job(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_next_seo_run_job(text, integer)
  to service_role;

create or replace function public.claim_seo_run_worker_pulse(
  p_worker_id text,
  p_lease_seconds integer default 300
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.seo_run_worker_control;
begin
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9._:-]{1,160}$' then
    raise exception 'invalid worker id';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 600 then
    raise exception 'pulse lease seconds must be between 60 and 600';
  end if;

  update public.seo_run_worker_control
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

create or replace function public.finish_seo_run_worker_pulse(
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
  update public.seo_run_worker_control
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

revoke all on function public.claim_seo_run_worker_pulse(text, integer)
  from public, anon, authenticated;
revoke all on function public.finish_seo_run_worker_pulse(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_seo_run_worker_pulse(text, integer)
  to service_role;
grant execute on function public.finish_seo_run_worker_pulse(text, jsonb)
  to service_role;

comment on function public.claim_next_seo_run_job(text, integer) is
  'Service-role-only durable SEO claim compatible with opaque sb_secret_ server keys.';
