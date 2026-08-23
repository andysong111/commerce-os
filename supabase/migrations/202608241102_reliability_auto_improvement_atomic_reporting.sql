begin;

create or replace function public.claim_reliability_auto_improvement_job(
  p_target_repo text,
  p_runner text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_lease uuid := gen_random_uuid();
  v_job jsonb;
begin
  select j.id into v_id
  from public.reliability_auto_improvement_jobs j
  where j.target_repo = p_target_repo
    and j.mode = 'auto'
    and j.status in ('queued','failed')
    and j.attempt_count < j.max_attempts
    and j.not_before <= now()
    and (j.lease_expires_at is null or j.lease_expires_at < now())
  order by j.created_at asc
  for update skip locked
  limit 1;

  if v_id is null then return null; end if;

  update public.reliability_auto_improvement_jobs
  set status = 'planning',
      attempt_count = attempt_count + 1,
      lease_token = v_lease,
      lease_runner = left(coalesce(p_runner,''), 200),
      lease_expires_at = now() + interval '120 minutes',
      last_error = null,
      updated_at = now()
  where id = v_id;

  perform public.record_reliability_auto_improvement_activity(
    v_id,'claimed','queued','planning','자동수정 계획을 만들기 시작했습니다.',
    jsonb_build_object('runner',left(coalesce(p_runner,''),200))
  );

  select to_jsonb(j) || jsonb_build_object('improvement',to_jsonb(i)) into v_job
  from public.reliability_auto_improvement_jobs j
  join public.reliability_improvements i on i.id=j.improvement_id
  where j.id=v_id;
  return v_job;
end;
$$;

create or replace function public.requeue_expired_reliability_auto_improvement_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_count integer := 0;
  v_next text;
begin
  for r in
    select id,status,attempt_count,max_attempts
    from public.reliability_auto_improvement_jobs
    where status in ('planning','ready','patch_created','validating','preview_passed','merged')
      and lease_expires_at is not null
      and lease_expires_at < now()
    for update skip locked
  loop
    v_next := case
      when r.status in ('preview_passed','merged') then 'blocked'
      when r.attempt_count < r.max_attempts then 'failed'
      else 'blocked'
    end;
    update public.reliability_auto_improvement_jobs
    set status=v_next,
        not_before=now()+interval '30 minutes',
        lease_token=null,
        lease_runner=null,
        lease_expires_at=null,
        last_error=case
          when r.status in ('preview_passed','merged')
            then '코드가 병합됐을 가능성이 있어 중복 자동수정을 막고 운영 상태 확인 대상으로 격리했습니다.'
          else '자동수정 실행이 완료 보고 없이 종료되어 안전하게 회수했습니다.'
        end,
        updated_at=now()
    where id=r.id;
    perform public.record_reliability_auto_improvement_activity(
      r.id,'lease_expired',r.status,v_next,
      case when v_next='blocked'
        then '중복 배포 위험을 막기 위해 자동 재실행하지 않고 격리했습니다.'
        else '중단된 자동수정 작업을 안전하게 다시 시도할 수 있도록 회수했습니다.' end,
      '{}'::jsonb
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.report_reliability_auto_improvement_stage(
  p_target_repo text,
  p_job_id uuid,
  p_lease_token uuid,
  p_status text,
  p_branch_name text default null,
  p_pr_number bigint default null,
  p_head_sha text default null,
  p_merge_sha text default null,
  p_preview_url text default null,
  p_production_url text default null,
  p_validation jsonb default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.reliability_auto_improvement_jobs%rowtype;
  v_next_status text;
  v_summary text;
  v_merge_sha text;
begin
  select * into v_job
  from public.reliability_auto_improvement_jobs
  where id=p_job_id
    and target_repo=p_target_repo
    and lease_token=p_lease_token
  for update;
  if not found then raise exception 'auto-improvement job or lease not found'; end if;

  if not (
    (v_job.status='ready' and p_status in ('patch_created','failed')) or
    (v_job.status='patch_created' and p_status in ('validating','failed')) or
    (v_job.status='validating' and p_status in ('preview_passed','failed')) or
    (v_job.status='preview_passed' and p_status in ('merged','production_verified','rolled_back','failed')) or
    (v_job.status='merged' and p_status in ('production_verified','rolled_back','failed'))
  ) then
    raise exception 'invalid auto-improvement transition: % -> %',v_job.status,p_status;
  end if;

  v_next_status := case
    when p_status='failed' and v_job.attempt_count >= v_job.max_attempts then 'blocked'
    else p_status
  end;
  v_merge_sha := coalesce(nullif(btrim(p_merge_sha),''),v_job.merge_sha);

  if p_status='production_verified' and v_merge_sha is null then
    raise exception 'production verified stage requires merge sha';
  end if;

  update public.reliability_auto_improvement_jobs
  set status=v_next_status,
      branch_name=coalesce(nullif(left(btrim(coalesce(p_branch_name,'')),300),''),branch_name),
      pr_number=coalesce(p_pr_number,pr_number),
      head_sha=coalesce(nullif(left(btrim(coalesce(p_head_sha,'')),80),''),head_sha),
      merge_sha=coalesce(nullif(left(btrim(coalesce(p_merge_sha,'')),80),''),merge_sha),
      preview_url=coalesce(nullif(left(btrim(coalesce(p_preview_url,'')),1000),''),preview_url),
      production_url=coalesce(nullif(left(btrim(coalesce(p_production_url,'')),1000),''),production_url),
      validation=case when p_validation is null then validation else p_validation end,
      last_error=case when p_error is null then last_error else left(p_error,1500) end,
      not_before=case when p_status='failed' then now()+interval '30 minutes' else not_before end,
      lease_token=case when p_status in ('failed','production_verified','rolled_back') then null else lease_token end,
      lease_runner=case when p_status in ('failed','production_verified','rolled_back') then null else lease_runner end,
      lease_expires_at=case when p_status in ('failed','production_verified','rolled_back') then null else lease_expires_at end,
      updated_at=now()
  where id=p_job_id;

  v_summary := case
    when p_status='production_verified' then '테스트와 미리보기를 통과한 수정이 실제 서비스에 반영됐습니다.'
    when p_status='rolled_back' then '운영 검증 실패로 자동으로 이전 상태로 되돌렸습니다.'
    when p_status='failed' then '안전 검증을 통과하지 못해 실제 서비스에는 반영하지 않았습니다.'
    else '자동개선 다음 단계를 통과했습니다.'
  end;
  perform public.record_reliability_auto_improvement_activity(
    p_job_id,p_status,v_job.status,v_next_status,v_summary,
    jsonb_strip_nulls(jsonb_build_object(
      'prNumber',p_pr_number,'headSha',p_head_sha,'mergeSha',p_merge_sha
    ))
  );

  if p_status='production_verified' then
    perform public.finalize_reliability_auto_improvement_regression(
      v_job.improvement_id,
      p_target_repo,
      v_merge_sha,
      coalesce(p_validation->>'test_path',v_job.validation->>'test_path',''),
      coalesce(p_validation->>'test_name',v_job.validation->>'test_name','자동개선 재발 방지 확인'),
      coalesce(p_validation,v_job.validation,'{}'::jsonb)
    );
  elsif p_status='rolled_back' then
    perform public.mark_reliability_auto_improvement_regression_failed(v_job.improvement_id);
  end if;

  return jsonb_build_object('ok',true,'status',v_next_status,'jobId',p_job_id);
end;
$$;

revoke all on function public.report_reliability_auto_improvement_stage(text,uuid,uuid,text,text,bigint,text,text,text,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.report_reliability_auto_improvement_stage(text,uuid,uuid,text,text,bigint,text,text,text,text,jsonb,text)
  to service_role;

comment on function public.report_reliability_auto_improvement_stage(text,uuid,uuid,text,text,bigint,text,text,text,text,jsonb,text) is
  'Atomically records guarded rollout state and promotes only Production-verified commits. Allows a final verified report even when the intermediate merged report response was lost.';

commit;