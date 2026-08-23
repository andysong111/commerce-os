begin;

create or replace function public.record_reliability_auto_improvement_activity(
  p_job_id uuid,
  p_event_type text,
  p_from_status text,
  p_to_status text,
  p_summary text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_job_id is null then raise exception 'job id is required'; end if;
  insert into public.reliability_auto_improvement_activity(
    job_id,event_type,from_status,to_status,summary,metadata
  ) values (
    p_job_id,
    left(coalesce(nullif(btrim(p_event_type),''),'status_changed'),120),
    left(nullif(btrim(p_from_status),''),80),
    left(nullif(btrim(p_to_status),''),80),
    left(coalesce(p_summary,''),1500),
    coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.save_reliability_auto_improvement_plan(
  p_job_id uuid,
  p_lease_token uuid,
  p_plan jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.reliability_auto_improvement_jobs
  set status='ready', plan=coalesce(p_plan,'{}'::jsonb), updated_at=now()
  where id=p_job_id and lease_token=p_lease_token and status='planning';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then return false; end if;
  perform public.record_reliability_auto_improvement_activity(
    p_job_id,'plan_ready','planning','ready',
    '수정할 파일과 변경 내용을 안전구역 안에서 확정했습니다.','{}'::jsonb
  );
  return true;
end;
$$;

create or replace function public.fail_reliability_auto_improvement_planning(
  p_job_id uuid,
  p_lease_token uuid,
  p_blocked boolean,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
  v_status text := case when coalesce(p_blocked,false) then 'blocked' else 'failed' end;
begin
  update public.reliability_auto_improvement_jobs
  set status=v_status,
      not_before=now()+interval '30 minutes',
      lease_token=null,
      lease_runner=null,
      lease_expires_at=null,
      last_error=left(coalesce(p_error,'자동개선 계획 실패'),1500),
      updated_at=now()
  where id=p_job_id and lease_token=p_lease_token and status='planning';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then return false; end if;
  perform public.record_reliability_auto_improvement_activity(
    p_job_id,'planning_failed','planning',v_status,
    case when v_status='blocked'
      then '자동수정 계획이 반복해서 안전검사를 통과하지 못해 자동 반영을 중단했습니다.'
      else '자동수정 계획이 안전검사를 통과하지 못해 실제 서비스에는 반영하지 않았습니다.' end,
    '{}'::jsonb
  );
  return true;
end;
$$;

create or replace function public.finalize_reliability_auto_improvement_regression(
  p_improvement_id uuid,
  p_target_repo text,
  p_merge_sha text,
  p_test_path text,
  p_test_name text,
  p_validation jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_improvement public.reliability_improvements%rowtype;
  v_regression_id uuid;
  v_evidence jsonb;
begin
  select * into v_improvement from public.reliability_improvements where id=p_improvement_id;
  if not found then raise exception 'improvement not found'; end if;
  if nullif(btrim(coalesce(p_merge_sha,'')),'') is null then raise exception 'merge sha is required'; end if;

  v_regression_id := v_improvement.regression_case_id;
  if v_regression_id is null then
    select id into v_regression_id
    from public.reliability_regression_cases
    where incident_id=v_improvement.incident_id
    order by updated_at desc
    limit 1;
  end if;

  v_evidence := jsonb_build_object(
    'autoImprovement',true,
    'validation',coalesce(p_validation,'{}'::jsonb),
    'productionVerifiedAt',now()
  );

  if v_regression_id is null then
    insert into public.reliability_regression_cases(
      incident_id,source_repo,test_path,test_name,protected_invariant,status,
      workflow_name,commit_sha,last_run_at,evidence
    ) values (
      v_improvement.incident_id,
      left(coalesce(p_target_repo,''),300),
      left(coalesce(p_test_path,''),500),
      left(coalesce(nullif(btrim(p_test_name),''),'자동개선 재발 방지 확인'),500),
      '동일한 저위험 운영 오류가 재발하지 않아야 합니다.',
      'implemented','Reliability Auto Improvement Validate',
      left(btrim(p_merge_sha),80),now(),v_evidence
    ) returning id into v_regression_id;
  else
    update public.reliability_regression_cases
    set source_repo=left(coalesce(p_target_repo,''),300),
        test_path=left(coalesce(p_test_path,''),500),
        test_name=left(coalesce(nullif(btrim(p_test_name),''),'자동개선 재발 방지 확인'),500),
        protected_invariant='동일한 저위험 운영 오류가 재발하지 않아야 합니다.',
        status='implemented',
        workflow_name='Reliability Auto Improvement Validate',
        commit_sha=left(btrim(p_merge_sha),80),
        last_run_at=now(),
        evidence=v_evidence,
        updated_at=now()
    where id=v_regression_id;
  end if;

  return v_regression_id;
end;
$$;

create or replace function public.mark_reliability_auto_improvement_regression_failed(
  p_improvement_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_regression_id uuid;
  v_updated integer;
begin
  select regression_case_id into v_regression_id
  from public.reliability_improvements where id=p_improvement_id;
  if v_regression_id is null then return false; end if;
  update public.reliability_regression_cases
  set status='failing',last_run_at=now(),updated_at=now()
  where id=v_regression_id;
  get diagnostics v_updated=row_count;
  return v_updated=1;
end;
$$;

revoke all on function public.record_reliability_auto_improvement_activity(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.save_reliability_auto_improvement_plan(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.fail_reliability_auto_improvement_planning(uuid,uuid,boolean,text) from public,anon,authenticated;
revoke all on function public.finalize_reliability_auto_improvement_regression(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.mark_reliability_auto_improvement_regression_failed(uuid) from public,anon,authenticated;
grant execute on function public.record_reliability_auto_improvement_activity(uuid,text,text,text,text,jsonb) to service_role;
grant execute on function public.save_reliability_auto_improvement_plan(uuid,uuid,jsonb) to service_role;
grant execute on function public.fail_reliability_auto_improvement_planning(uuid,uuid,boolean,text) to service_role;
grant execute on function public.finalize_reliability_auto_improvement_regression(uuid,text,text,text,text,jsonb) to service_role;
grant execute on function public.mark_reliability_auto_improvement_regression_failed(uuid) to service_role;

comment on function public.save_reliability_auto_improvement_plan(uuid,uuid,jsonb) is
  'Atomically stores a leased low-risk AI plan and its activity record using service-role only.';
comment on function public.finalize_reliability_auto_improvement_regression(uuid,text,text,text,text,jsonb) is
  'Promotes only a Production-verified merge commit into reliability regression evidence.';

commit;