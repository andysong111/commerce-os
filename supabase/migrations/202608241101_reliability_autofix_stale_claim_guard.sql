begin;

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

  update public.reliability_improvements i
  set status = 'approval_required',
      requires_approval = true,
      metadata = i.metadata || jsonb_build_object(
        'autofixEscalatedAt', now(),
        'autofixEscalationReason', '자동수정 Worker가 결과를 기록하지 못한 채 종료되어 중복 배포 방지를 위해 사람 확인으로 전환했습니다.'
      )
  where i.id in (
    select j.improvement_id
    from public.reliability_autofix_jobs j
    where j.target_repo = p_repo
      and j.status = 'claimed'
      and j.claimed_at < now() - interval '90 minutes'
  );

  update public.reliability_autofix_jobs j
  set status = 'approval_required',
      last_error = left(
        concat_ws(E'\n', nullif(j.last_error, ''), 'abandoned claim escalated; automatic replay blocked'),
        2000
      )
  where j.target_repo = p_repo
    and j.status = 'claimed'
    and j.claimed_at < now() - interval '90 minutes';

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

revoke all on function public.claim_reliability_autofix_job(text,text)
  from public, anon, authenticated;
grant execute on function public.claim_reliability_autofix_job(text,text)
  to service_role;

comment on function public.claim_reliability_autofix_job(text,text) is
  'Claims one low-risk autofix job. Abandoned claims are escalated rather than replayed, preventing duplicate code deployment when a worker dies after merge.';

commit;
