begin;

alter table public.reliability_autofix_jobs
  add column if not exists failure_stage text,
  add column if not exists failure_step text,
  add column if not exists failure_run_id text,
  add column if not exists quarantined_at timestamptz;

alter table public.reliability_autofix_jobs
  drop constraint if exists reliability_autofix_jobs_status_check;
alter table public.reliability_autofix_jobs
  add constraint reliability_autofix_jobs_status_check check (
    status in (
      'queued','claimed','patch_ready','validating','pr_open','merged','deployed',
      'approval_required','failed','quarantined','rejected','canceled'
    )
  );

revoke all on function public.enqueue_reliability_autofix_from_improvement_trigger() from public;
revoke all on function public.enqueue_reliability_autofix_from_improvement_trigger() from anon;
revoke all on function public.enqueue_reliability_autofix_from_improvement_trigger() from authenticated;
grant execute on function public.enqueue_reliability_autofix_from_improvement_trigger() to service_role;

create or replace function public.enforce_reliability_improvement_approval_policy()
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
    new.requires_approval := false;
  elsif new.status in ('analysis_pending','approval_required')
     or new.risk_level in ('high','critical') then
    new.requires_approval := true;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_reliability_improvement_approval_policy() from public;
revoke all on function public.enforce_reliability_improvement_approval_policy() from anon;
revoke all on function public.enforce_reliability_improvement_approval_policy() from authenticated;
grant execute on function public.enforce_reliability_improvement_approval_policy() to service_role;

drop trigger if exists reliability_improvements_enforce_approval_policy on public.reliability_improvements;
create trigger reliability_improvements_enforce_approval_policy
before insert or update of status,risk_level,confidence,safe_action,improvement_kind,target_repo,requires_approval
on public.reliability_improvements
for each row execute function public.enforce_reliability_improvement_approval_policy();

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
      'eligibilityVersion', 'autofix-v2'
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
    and coalesce(i.requires_approval, true) = false
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

revoke all on function public.enqueue_reliability_autofix_candidates() from public;
revoke all on function public.enqueue_reliability_autofix_candidates() from anon;
revoke all on function public.enqueue_reliability_autofix_candidates() from authenticated;
grant execute on function public.enqueue_reliability_autofix_candidates() to service_role;

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
     )
     and coalesce(new.requires_approval, true) = false then
    insert into public.reliability_autofix_jobs(improvement_id, target_repo, metadata)
    values (
      new.id,
      new.target_repo,
      jsonb_build_object('eligibilityVersion','autofix-v2')
    )
    on conflict (improvement_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.enqueue_reliability_autofix_from_improvement_trigger() from public;
revoke all on function public.enqueue_reliability_autofix_from_improvement_trigger() from anon;
revoke all on function public.enqueue_reliability_autofix_from_improvement_trigger() from authenticated;
grant execute on function public.enqueue_reliability_autofix_from_improvement_trigger() to service_role;

create or replace function public.quarantine_exhausted_reliability_autofix_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'failed' and new.attempts >= new.max_attempts then
    new.status := 'quarantined';
    new.quarantined_at := coalesce(new.quarantined_at, now());
    new.failure_stage := coalesce(new.failure_stage, 'premerge_validation');
    new.failure_run_id := coalesce(new.failure_run_id, new.github_run_id);
  end if;
  return new;
end;
$$;

revoke all on function public.quarantine_exhausted_reliability_autofix_job() from public;
revoke all on function public.quarantine_exhausted_reliability_autofix_job() from anon;
revoke all on function public.quarantine_exhausted_reliability_autofix_job() from authenticated;
grant execute on function public.quarantine_exhausted_reliability_autofix_job() to service_role;

drop trigger if exists reliability_autofix_jobs_quarantine_exhausted on public.reliability_autofix_jobs;
create trigger reliability_autofix_jobs_quarantine_exhausted
before insert or update of status,attempts,max_attempts
on public.reliability_autofix_jobs
for each row execute function public.quarantine_exhausted_reliability_autofix_job();

create or replace function public.escalate_quarantined_reliability_autofix_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'quarantined' and old.status is distinct from new.status then
    update public.reliability_improvements
    set status = 'approval_required',
        requires_approval = true,
        metadata = metadata || jsonb_build_object(
          'autofixQuarantinedAt', coalesce(new.quarantined_at, now()),
          'autofixQuarantineReason', left(coalesce(new.last_error, '자동수정 최대 재시도 횟수를 초과했습니다.'), 1000),
          'autofixJobId', new.id,
          'autofixRunId', new.github_run_id
        )
    where id = new.improvement_id;
  end if;
  return new;
end;
$$;

revoke all on function public.escalate_quarantined_reliability_autofix_job() from public;
revoke all on function public.escalate_quarantined_reliability_autofix_job() from anon;
revoke all on function public.escalate_quarantined_reliability_autofix_job() from authenticated;
grant execute on function public.escalate_quarantined_reliability_autofix_job() to service_role;

drop trigger if exists reliability_autofix_jobs_escalate_quarantined on public.reliability_autofix_jobs;
create trigger reliability_autofix_jobs_escalate_quarantined
after update of status on public.reliability_autofix_jobs
for each row execute function public.escalate_quarantined_reliability_autofix_job();

update public.reliability_improvements
set requires_approval = requires_approval;

update public.reliability_autofix_jobs
set status = 'failed'
where status = 'failed' and attempts >= max_attempts;

commit;
