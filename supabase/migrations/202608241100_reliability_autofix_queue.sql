begin;

create table if not exists public.reliability_autofix_jobs (
  id uuid primary key default gen_random_uuid(),
  improvement_id uuid not null unique references public.reliability_improvements(id) on delete cascade,
  target_repo text not null check (target_repo in (
    'andysong111/commerce-os-ops-center',
    'andysong111/commerce-os-detail-page-saas'
  )),
  status text not null default 'queued' check (status in (
    'queued','claimed','patch_ready','validating','pr_open','merged','deployed',
    'approval_required','failed','rejected','canceled'
  )),
  attempts integer not null default 0 check (attempts between 0 and 10),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  not_before timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by text,
  github_run_id text,
  branch_name text,
  pr_number integer,
  commit_sha text,
  merge_sha text,
  patch_summary text,
  changed_paths jsonb not null default '[]'::jsonb,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reliability_autofix_jobs_status_idx
  on public.reliability_autofix_jobs(status, not_before, created_at);
create index if not exists reliability_autofix_jobs_repo_idx
  on public.reliability_autofix_jobs(target_repo, status, not_before);

drop trigger if exists reliability_autofix_jobs_set_updated_at
  on public.reliability_autofix_jobs;
create trigger reliability_autofix_jobs_set_updated_at
before update on public.reliability_autofix_jobs
for each row execute function public.set_reliability_updated_at();

create or replace function public.enqueue_reliability_autofix_candidates()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  insert into public.reliability_autofix_jobs(
    improvement_id,
    target_repo,
    status,
    metadata
  )
  select
    i.id,
    i.target_repo,
    'queued',
    jsonb_strip_nulls(jsonb_build_object(
      'riskLevel', i.risk_level,
      'confidence', i.confidence,
      'improvementKind', i.improvement_kind,
      'safeAction', i.safe_action,
      'classification', i.metadata->>'classification',
      'eligibilityVersion', 'autofix-v1'
    ))
  from public.reliability_improvements i
  where i.status = 'implementation_needed'
    and i.risk_level = 'low'
    and i.confidence >= 0.65
    and i.safe_action in ('retry','resume_checkpoint','revalidate','quarantine')
    and i.improvement_kind in ('retry_policy','validation_rule','quality_gate','configuration')
    and i.target_repo in (
      'andysong111/commerce-os-ops-center',
      'andysong111/commerce-os-detail-page-saas'
    )
    and coalesce(i.requires_approval, true) = true
  on conflict (improvement_id) do nothing;

  get diagnostics v_inserted = row_count;

  return jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'queued', (
      select count(*) from public.reliability_autofix_jobs where status = 'queued'
    )
  );
end;
$$;

create or replace function public.claim_reliability_autofix_job(
  p_repo text,
  p_run_id text
)
returns table(
  job_id uuid,
  improvement_id uuid,
  incident_id uuid,
  target_repo text,
  engine text,
  error_code text,
  title text,
  fact_summary text,
  root_cause text,
  change_summary text,
  prevention_rule text,
  expected_effect text,
  improvement_kind text,
  safe_action text,
  risk_level text,
  confidence numeric,
  target_test_name text,
  protected_invariant text,
  occurrence_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  perform public.enqueue_reliability_autofix_candidates();

  update public.reliability_autofix_jobs j
  set status = 'queued',
      claimed_at = null,
      claimed_by = null,
      github_run_id = null,
      not_before = now(),
      last_error = coalesce(j.last_error, '') || case
        when coalesce(j.last_error, '') = '' then ''
        else E'\n'
      end || 'stale claim recovered'
  where j.target_repo = p_repo
    and j.status = 'claimed'
    and j.claimed_at < now() - interval '45 minutes'
    and j.attempts < j.max_attempts;

  select j.id into v_job_id
  from public.reliability_autofix_jobs j
  join public.reliability_improvements i on i.id = j.improvement_id
  where j.target_repo = p_repo
    and j.status = 'queued'
    and j.not_before <= now()
    and j.attempts < j.max_attempts
    and i.status = 'implementation_needed'
    and i.risk_level = 'low'
    and i.confidence >= 0.65
    and i.safe_action in ('retry','resume_checkpoint','revalidate','quarantine')
  order by i.confidence desc, j.created_at asc
  for update of j skip locked
  limit 1;

  if v_job_id is null then
    return;
  end if;

  update public.reliability_autofix_jobs
  set status = 'claimed',
      attempts = attempts + 1,
      claimed_at = now(),
      claimed_by = p_repo,
      github_run_id = left(coalesce(p_run_id, ''), 200)
  where id = v_job_id;

  return query
  select
    j.id,
    i.id,
    i.incident_id,
    j.target_repo,
    i.engine,
    i.error_code,
    i.title,
    i.fact_summary,
    i.root_cause,
    i.change_summary,
    i.prevention_rule,
    i.expected_effect,
    i.improvement_kind,
    i.safe_action,
    i.risk_level,
    i.confidence,
    i.target_test_name,
    coalesce(r.protected_invariant, ''),
    coalesce((i.metadata->>'occurrenceCount')::bigint, 0)
  from public.reliability_autofix_jobs j
  join public.reliability_improvements i on i.id = j.improvement_id
  left join public.reliability_regression_cases r on r.id = i.regression_case_id
  where j.id = v_job_id;
end;
$$;

create or replace function public.finish_reliability_autofix_job(
  p_job_id uuid,
  p_status text,
  p_branch_name text default null,
  p_pr_number integer default null,
  p_commit_sha text default null,
  p_merge_sha text default null,
  p_patch_summary text default null,
  p_changed_paths jsonb default '[]'::jsonb,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.reliability_autofix_jobs%rowtype;
  v_improvement public.reliability_improvements%rowtype;
  v_regression_id uuid;
  v_next_not_before timestamptz;
begin
  if p_status not in (
    'queued','patch_ready','validating','pr_open','merged','deployed',
    'approval_required','failed','rejected','canceled'
  ) then
    raise exception 'unsupported autofix status';
  end if;

  select * into v_job
  from public.reliability_autofix_jobs
  where id = p_job_id
  for update;
  if not found then
    raise exception 'autofix job not found';
  end if;

  select * into v_improvement
  from public.reliability_improvements
  where id = v_job.improvement_id;

  v_next_not_before := case
    when p_status = 'failed' and v_job.attempts < v_job.max_attempts
      then now() + make_interval(mins => least(120, 10 * (2 ^ greatest(0, v_job.attempts - 1))::integer))
    else v_job.not_before
  end;

  update public.reliability_autofix_jobs
  set status = case
        when p_status = 'failed' and attempts < max_attempts then 'queued'
        else p_status
      end,
      not_before = v_next_not_before,
      branch_name = coalesce(nullif(p_branch_name, ''), branch_name),
      pr_number = coalesce(p_pr_number, pr_number),
      commit_sha = coalesce(nullif(p_commit_sha, ''), commit_sha),
      merge_sha = coalesce(nullif(p_merge_sha, ''), merge_sha),
      patch_summary = coalesce(nullif(left(p_patch_summary, 2000), ''), patch_summary),
      changed_paths = case
        when jsonb_typeof(coalesce(p_changed_paths, '[]'::jsonb)) = 'array'
          then coalesce(p_changed_paths, '[]'::jsonb)
        else changed_paths
      end,
      last_error = case
        when p_error is null then last_error
        else left(p_error, 2000)
      end
  where id = p_job_id;

  if p_status = 'approval_required' then
    update public.reliability_improvements
    set status = 'approval_required',
        requires_approval = true,
        metadata = metadata || jsonb_build_object(
          'autofixEscalatedAt', now(),
          'autofixEscalationReason', left(coalesce(p_error, '자동수정 안전 경계를 벗어났습니다.'), 1000)
        )
    where id = v_job.improvement_id;
  elsif p_status = 'deployed' and nullif(p_merge_sha, '') is not null then
    v_regression_id := v_improvement.regression_case_id;
    if v_regression_id is not null then
      update public.reliability_regression_cases
      set status = 'passing',
          commit_sha = p_merge_sha,
          workflow_name = 'Reliability Safe Autofix',
          updated_at = now()
      where id = v_regression_id;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'jobId', p_job_id,
    'status', (
      select status from public.reliability_autofix_jobs where id = p_job_id
    )
  );
end;
$$;

create or replace function public.enqueue_reliability_autofix_from_improvement_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'implementation_needed'
     and new.risk_level = 'low'
     and new.confidence >= 0.65
     and new.safe_action in ('retry','resume_checkpoint','revalidate','quarantine')
     and new.improvement_kind in ('retry_policy','validation_rule','quality_gate','configuration')
     and new.target_repo in (
       'andysong111/commerce-os-ops-center',
       'andysong111/commerce-os-detail-page-saas'
     ) then
    insert into public.reliability_autofix_jobs(improvement_id, target_repo)
    values (new.id, new.target_repo)
    on conflict (improvement_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists enqueue_reliability_autofix_from_improvement
  on public.reliability_improvements;
create trigger enqueue_reliability_autofix_from_improvement
after insert or update of status, risk_level, confidence, safe_action, improvement_kind, target_repo
on public.reliability_improvements
for each row execute function public.enqueue_reliability_autofix_from_improvement_trigger();

select public.enqueue_reliability_autofix_candidates();

revoke all on table public.reliability_autofix_jobs from public, anon, authenticated;
grant all on table public.reliability_autofix_jobs to service_role;

revoke all on function public.enqueue_reliability_autofix_candidates() from public, anon, authenticated;
revoke all on function public.claim_reliability_autofix_job(text,text) from public, anon, authenticated;
revoke all on function public.finish_reliability_autofix_job(uuid,text,text,integer,text,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.enqueue_reliability_autofix_candidates() to service_role;
grant execute on function public.claim_reliability_autofix_job(text,text) to service_role;
grant execute on function public.finish_reliability_autofix_job(uuid,text,text,integer,text,text,text,jsonb,text) to service_role;

comment on table public.reliability_autofix_jobs is
  'Audited queue for low-risk, CI-gated AI code fixes. High-risk business writes never enter this queue.';

commit;
