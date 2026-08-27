-- Prevent two SEO RUNs for the same product from generating concurrently.
-- This keeps per-product title exclusions deterministic while different products stay parallel.

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
  v_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if v_role <> 'service_role' then
    raise exception 'service_role required';
  end if;
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
      attempt_count = attempt_count + 1,
      lease_owner = p_worker_id,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(started_at, now()),
      error_message = '',
      updated_at = now()
  where run_id = v_job.run_id
  returning * into v_job;

  return jsonb_build_object(
    'claimed', true,
    'job', to_jsonb(v_job)
  );
end;
$$;

revoke all on function public.claim_next_seo_run_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_next_seo_run_job(text, integer) to service_role;
