-- Durable SEO RUN queue.
-- Browser creates RUN rows; Vercel cron workers execute and checkpoint each stage.

create table if not exists public.seo_run_jobs (
  run_id text primary key,
  owner_id uuid not null,
  owner_email text not null default '',
  batch_id text not null default '',
  launch_item_id text not null,
  tracker_row_number integer,
  model_number text not null default '',
  product_name text not null default '',
  source_url text not null,
  status text not null default 'queued',
  stage text not null default 'collect_source',
  stage_index integer not null default 0,
  progress_percent integer not null default 0,
  message text not null default '서버 실행 대기',
  input_payload jsonb not null default '{}'::jsonb,
  checkpoint_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  error_message text not null default '',
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  not_before timestamptz not null default now(),
  lease_owner text,
  lease_until timestamptz,
  registration_status text not null default 'idle',
  registration_job_id text not null default '',
  registration_request_id text not null default '',
  registration_payload jsonb not null default '{}'::jsonb,
  run_created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seo_run_jobs_status_check
    check (status in ('queued','running','ready','failed','cancelled')),
  constraint seo_run_jobs_stage_check
    check (stage in (
      'collect_source','analyze_identity','discover_keywords','score_keywords',
      'expand_keywords','filter_keywords','generate_title','compose_final','completed'
    )),
  constraint seo_run_jobs_progress_check
    check (progress_percent between 0 and 100),
  constraint seo_run_jobs_attempt_check
    check (attempt_count >= 0 and max_attempts between 1 and 20),
  constraint seo_run_jobs_registration_status_check
    check (registration_status in ('idle','submitting','queued','running','success','failed')),
  constraint seo_run_jobs_run_id_length_check
    check (char_length(run_id) between 8 and 180),
  constraint seo_run_jobs_batch_id_length_check
    check (char_length(batch_id) <= 180),
  constraint seo_run_jobs_launch_item_id_length_check
    check (char_length(launch_item_id) between 1 and 180)
);

create index if not exists seo_run_jobs_owner_active_idx
  on public.seo_run_jobs(owner_id, archived_at, run_created_at desc);

create index if not exists seo_run_jobs_claim_idx
  on public.seo_run_jobs(status, not_before, lease_until, run_created_at)
  where archived_at is null and status in ('queued','running');

create index if not exists seo_run_jobs_launch_item_idx
  on public.seo_run_jobs(owner_id, launch_item_id, run_created_at desc);

alter table public.seo_run_jobs enable row level security;

revoke all on table public.seo_run_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.seo_run_jobs to service_role;

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

comment on table public.seo_run_jobs is
  'Durable SEO RUN queue with stage checkpoints. Vercel workers continue while user devices are offline.';
