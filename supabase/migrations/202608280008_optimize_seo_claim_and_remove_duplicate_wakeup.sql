-- Production incident 2026-08-28:
-- claim_next_seo_run_job sorted `job.*`, including several large JSONB payloads,
-- before choosing a single candidate. pg_stat_statements showed the RPC spilling
-- thousands of temp blocks and averaging multiple seconds even with only a few
-- dozen jobs. This amplified PostgREST 503/504 and Vercel function timeouts.
--
-- Preserve every durable-claim invariant (same-item serialization, attempts,
-- leases, SKIP LOCKED) while locking/sorting only the narrow run_id. Load the
-- full payload only after one row has been chosen.

create index if not exists seo_run_jobs_claim_order_narrow_idx
  on public.seo_run_jobs (not_before, run_created_at, created_at, run_id)
  include (owner_id, launch_item_id, status, lease_until, attempt_count, max_attempts)
  where archived_at is null
    and status in ('queued', 'running');

create index if not exists seo_run_jobs_active_item_lease_idx
  on public.seo_run_jobs (owner_id, launch_item_id, lease_until)
  include (run_id)
  where archived_at is null
    and status = 'running';

create or replace function public.claim_next_seo_run_job(
  p_worker_id text,
  p_lease_seconds integer default 420
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_run_id text;
  v_job public.seo_run_jobs;
begin
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9._:-]{1,120}$' then
    raise exception 'invalid worker id';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 900 then
    raise exception 'lease seconds must be between 60 and 900';
  end if;

  select job.run_id into v_run_id
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
  for update of job skip locked;

  if v_run_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  update public.seo_run_jobs
  set status = 'running',
      lease_owner = p_worker_id,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(started_at, now()),
      error_message = '',
      updated_at = now()
  where run_id = v_run_id
  returning * into v_job;

  return jsonb_build_object('claimed', true, 'job', to_jsonb(v_job));
end;
$function$;

-- Vercel /api/cron/seo-run-worker remains the durable primary. During this DB
-- recovery window it is bounded to a five-minute cadence; enqueue requests also
-- kick the worker immediately through the existing server-side after() path.
-- Remove the DB-side HTTP wakeup entirely: it duplicates the same worker and,
-- during a degraded DB period, pg_cron/pg_net can add more pressure instead of
-- recovering work. Durable queued jobs remain safely stored until Vercel's next
-- successful claim.
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'commerce-os-seo-run-wakeup'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end;
$$;
