begin;

create table if not exists public.reliability_improvements (
  id uuid primary key default gen_random_uuid(),
  learning_case_id uuid not null unique references public.reliability_learning_cases(id) on delete cascade,
  incident_id uuid not null references public.reliability_incidents(id) on delete cascade,
  regression_case_id uuid references public.reliability_regression_cases(id) on delete set null,
  policy_id uuid references public.reliability_recovery_policies(id) on delete set null,
  source_system text not null,
  engine text not null,
  error_code text,
  title text not null default '',
  fact_summary text not null default '',
  root_cause text not null default '',
  change_summary text not null default '',
  prevention_rule text not null default '',
  expected_effect text not null default '',
  improvement_kind text not null default 'manual_review' check (
    improvement_kind in (
      'retry_policy','validation_rule','quality_gate','quarantine_rule',
      'configuration','code_change','regression_test','manual_review'
    )
  ),
  status text not null default 'analysis_pending' check (
    status in (
      'analysis_pending','implementation_needed','approval_required','policy_active',
      'applied','measuring','verified','neutral','regressed','rejected','rolled_back'
    )
  ),
  application_mode text not null default 'none' check (
    application_mode in ('none','existing_policy','automatic_policy','github_change','manual_change')
  ),
  safe_action text not null default 'none' check (
    safe_action in ('none','retry','resume_checkpoint','revalidate','quarantine')
  ),
  policy_action text,
  risk_level text not null default 'low' check (
    risk_level in ('low','medium','high','critical')
  ),
  confidence numeric(5,4) not null default 0 check (confidence between 0 and 1),
  requires_approval boolean not null default true,
  target_repo text,
  target_test_name text,
  applied_at timestamptz,
  applied_reference text,
  baseline_started_at timestamptz,
  baseline_ended_at timestamptz,
  current_started_at timestamptz,
  current_ended_at timestamptz,
  baseline_events bigint not null default 0 check (baseline_events >= 0),
  baseline_failures bigint not null default 0 check (baseline_failures >= 0),
  baseline_recoveries bigint not null default 0 check (baseline_recoveries >= 0),
  current_events bigint not null default 0 check (current_events >= 0),
  current_failures bigint not null default 0 check (current_failures >= 0),
  current_recoveries bigint not null default 0 check (current_recoveries >= 0),
  baseline_failure_rate numeric(8,5),
  current_failure_rate numeric(8,5),
  current_recovery_rate numeric(8,5),
  improvement_percent numeric(10,2),
  measurement_result text not null default 'not_started' check (
    measurement_result in ('not_started','insufficient_data','improved','unchanged','regressed')
  ),
  last_measured_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reliability_improvements_status_idx
  on public.reliability_improvements(status, updated_at desc);
create index if not exists reliability_improvements_engine_idx
  on public.reliability_improvements(source_system, engine, updated_at desc);
create index if not exists reliability_improvements_measurement_idx
  on public.reliability_improvements(measurement_result, last_measured_at desc);
create index if not exists reliability_improvements_applied_idx
  on public.reliability_improvements(applied_at desc)
  where applied_at is not null;

drop trigger if exists reliability_improvements_set_updated_at
  on public.reliability_improvements;
create trigger reliability_improvements_set_updated_at
before update on public.reliability_improvements
for each row execute function public.set_reliability_updated_at();

create table if not exists public.reliability_improvement_activity (
  id uuid primary key default gen_random_uuid(),
  improvement_id uuid not null references public.reliability_improvements(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'created','status_changed','policy_activated','change_applied',
      'measurement_updated','verified','regressed','rejected','rolled_back'
    )
  ),
  from_status text,
  to_status text,
  summary text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists reliability_improvement_activity_timeline_idx
  on public.reliability_improvement_activity(improvement_id, occurred_at desc);

create or replace function public.reliability_improvement_kind(
  p_classification text,
  p_safe_action text
)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_safe_action,'')) in ('retry','resume_checkpoint') then 'retry_policy'
    when lower(coalesce(p_safe_action,'')) = 'quarantine' then 'quarantine_rule'
    when lower(coalesce(p_classification,'')) = 'quality_defect' then 'quality_gate'
    when lower(coalesce(p_classification,'')) = 'input_validation'
      or lower(coalesce(p_safe_action,'')) = 'revalidate' then 'validation_rule'
    when lower(coalesce(p_classification,'')) = 'configuration' then 'configuration'
    when lower(coalesce(p_classification,'')) = 'code_defect' then 'code_change'
    when lower(coalesce(p_classification,'')) in ('transient','external_dependency') then 'retry_policy'
    else 'manual_review'
  end;
$$;

create or replace function public.sync_reliability_improvement_for_learning_case(
  p_learning_case_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_learning public.reliability_learning_cases%rowtype;
  v_incident public.reliability_incidents%rowtype;
  v_regression public.reliability_regression_cases%rowtype;
  v_policy public.reliability_recovery_policies%rowtype;
  v_has_regression boolean := false;
  v_has_policy boolean := false;
  v_classification text;
  v_safe_action text;
  v_kind text;
  v_status text;
  v_application_mode text := 'none';
  v_requires_approval boolean := true;
  v_applied_at timestamptz;
  v_applied_reference text;
  v_fact_summary text;
  v_change_summary text;
  v_expected_effect text;
  v_improvement_id uuid;
begin
  select * into v_learning
  from public.reliability_learning_cases
  where id = p_learning_case_id;

  if not found then
    return null;
  end if;

  select * into v_incident
  from public.reliability_incidents
  where id = v_learning.incident_id;

  if not found then
    return null;
  end if;

  select * into v_regression
  from public.reliability_regression_cases
  where incident_id = v_incident.id
  order by
    case status
      when 'passing' then 1
      when 'implemented' then 2
      when 'proposed' then 3
      else 4
    end,
    updated_at desc
  limit 1;
  v_has_regression := found;

  if v_incident.error_code is not null then
    select * into v_policy
    from public.reliability_recovery_policies
    where enabled = true
      and source_system = v_incident.source_system
      and engine = v_incident.engine
      and error_code = v_incident.error_code
    order by updated_at desc
    limit 1;
    v_has_policy := found;
  end if;

  v_classification := lower(coalesce(
    nullif(v_learning.evidence->'aiAnalysis'->>'classification',''),
    'unknown'
  ));
  v_safe_action := lower(coalesce(
    nullif(v_learning.evidence->'aiAnalysis'->>'safe_automatic_action',''),
    'none'
  ));
  if v_safe_action not in ('none','retry','resume_checkpoint','revalidate','quarantine') then
    v_safe_action := 'none';
  end if;

  v_kind := public.reliability_improvement_kind(v_classification, v_safe_action);
  v_fact_summary := coalesce(
    nullif(v_learning.evidence->'aiAnalysis'->>'fact_summary',''),
    nullif(v_learning.symptom,''),
    concat(v_incident.engine, '에서 반복 오류가 감지되었습니다.')
  );
  v_change_summary := coalesce(
    nullif(v_learning.resolution,''),
    nullif(v_learning.prevention_rule,''),
    '분석이 완료되면 적용 가능한 변경안을 생성합니다.'
  );
  v_expected_effect := coalesce(
    nullif(v_learning.prevention_rule,''),
    '동일 오류의 재발률을 낮추고 자동복구 성공률을 높입니다.'
  );

  if nullif(v_learning.root_cause,'') is null
     or nullif(v_learning.resolution,'') is null
     or nullif(v_learning.prevention_rule,'') is null then
    v_status := 'analysis_pending';
  elsif v_incident.risk_level in ('high','critical') then
    v_status := 'approval_required';
  elsif v_has_regression
    and v_regression.status in ('implemented','passing')
    and nullif(v_regression.commit_sha,'') is not null then
    v_status := 'applied';
    v_application_mode := 'github_change';
    v_requires_approval := false;
    v_applied_at := v_regression.updated_at;
    v_applied_reference := concat('commit:', v_regression.commit_sha);
  elsif v_has_policy
    and v_safe_action <> 'none'
    and not v_policy.requires_approval
    and v_policy.risk_level not in ('high','critical') then
    v_status := 'policy_active';
    v_application_mode := 'existing_policy';
    v_requires_approval := false;
    v_applied_at := v_policy.created_at;
    v_applied_reference := concat('recovery-policy:', v_policy.id::text);
  elsif v_has_policy and (v_policy.requires_approval or v_policy.risk_level in ('high','critical')) then
    v_status := 'approval_required';
  else
    v_status := 'implementation_needed';
  end if;

  if v_status in ('analysis_pending','implementation_needed','approval_required') then
    v_requires_approval := true;
  end if;

  insert into public.reliability_improvements(
    learning_case_id,
    incident_id,
    regression_case_id,
    policy_id,
    source_system,
    engine,
    error_code,
    title,
    fact_summary,
    root_cause,
    change_summary,
    prevention_rule,
    expected_effect,
    improvement_kind,
    status,
    application_mode,
    safe_action,
    policy_action,
    risk_level,
    confidence,
    requires_approval,
    target_repo,
    target_test_name,
    applied_at,
    applied_reference,
    metadata
  ) values (
    v_learning.id,
    v_incident.id,
    case when v_has_regression then v_regression.id else null end,
    case when v_has_policy then v_policy.id else null end,
    v_incident.source_system,
    v_incident.engine,
    v_incident.error_code,
    concat(
      v_incident.engine,
      ' · ',
      coalesce(nullif(v_incident.error_code,''), nullif(v_learning.title,''), '반복 오류'),
      ' 개선'
    ),
    left(v_fact_summary, 2000),
    left(coalesce(v_learning.root_cause,''), 4000),
    left(v_change_summary, 4000),
    left(coalesce(v_learning.prevention_rule,''), 4000),
    left(v_expected_effect, 4000),
    v_kind,
    v_status,
    v_application_mode,
    v_safe_action,
    case when v_has_policy then v_policy.action else null end,
    v_incident.risk_level,
    greatest(0, least(1, coalesce(v_learning.confidence, 0))),
    v_requires_approval,
    case when v_has_regression then v_regression.source_repo else null end,
    case when v_has_regression then v_regression.test_name else null end,
    v_applied_at,
    v_applied_reference,
    jsonb_strip_nulls(jsonb_build_object(
      'classification', v_classification,
      'occurrenceCount', v_incident.occurrence_count,
      'regressionStatus', case when v_has_regression then v_regression.status else null end,
      'policyRequiresApproval', case when v_has_policy then v_policy.requires_approval else null end,
      'policyRiskLevel', case when v_has_policy then v_policy.risk_level else null end
    ))
  )
  on conflict (learning_case_id) do update set
    incident_id = excluded.incident_id,
    regression_case_id = excluded.regression_case_id,
    policy_id = excluded.policy_id,
    source_system = excluded.source_system,
    engine = excluded.engine,
    error_code = excluded.error_code,
    title = excluded.title,
    fact_summary = excluded.fact_summary,
    root_cause = excluded.root_cause,
    change_summary = excluded.change_summary,
    prevention_rule = excluded.prevention_rule,
    expected_effect = excluded.expected_effect,
    improvement_kind = excluded.improvement_kind,
    status = case
      when public.reliability_improvements.status in (
        'verified','neutral','regressed','rejected','rolled_back'
      ) then public.reliability_improvements.status
      else excluded.status
    end,
    application_mode = case
      when public.reliability_improvements.status in (
        'verified','neutral','regressed','rejected','rolled_back'
      ) then public.reliability_improvements.application_mode
      else excluded.application_mode
    end,
    safe_action = excluded.safe_action,
    policy_action = excluded.policy_action,
    risk_level = excluded.risk_level,
    confidence = excluded.confidence,
    requires_approval = excluded.requires_approval,
    target_repo = excluded.target_repo,
    target_test_name = excluded.target_test_name,
    applied_at = coalesce(public.reliability_improvements.applied_at, excluded.applied_at),
    applied_reference = coalesce(excluded.applied_reference, public.reliability_improvements.applied_reference),
    metadata = public.reliability_improvements.metadata || excluded.metadata,
    updated_at = now()
  returning id into v_improvement_id;

  return v_improvement_id;
end;
$$;

create or replace function public.sync_reliability_improvement_from_learning_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_reliability_improvement_for_learning_case(new.id);
  return new;
end;
$$;

drop trigger if exists sync_reliability_improvement_from_learning
  on public.reliability_learning_cases;
create trigger sync_reliability_improvement_from_learning
after insert or update of state, root_cause, resolution, prevention_rule, confidence, evidence
on public.reliability_learning_cases
for each row execute function public.sync_reliability_improvement_from_learning_trigger();

create or replace function public.sync_reliability_improvement_from_regression_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_learning_id uuid;
begin
  for v_learning_id in
    select id
    from public.reliability_learning_cases
    where incident_id = new.incident_id
  loop
    perform public.sync_reliability_improvement_for_learning_case(v_learning_id);
  end loop;
  return new;
end;
$$;

drop trigger if exists sync_reliability_improvement_from_regression
  on public.reliability_regression_cases;
create trigger sync_reliability_improvement_from_regression
after insert or update of status, commit_sha, test_path, test_name, protected_invariant
on public.reliability_regression_cases
for each row execute function public.sync_reliability_improvement_from_regression_trigger();

create or replace function public.sync_reliability_improvement_from_policy_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_learning_id uuid;
begin
  for v_learning_id in
    select l.id
    from public.reliability_learning_cases l
    join public.reliability_incidents i on i.id = l.incident_id
    where i.source_system = new.source_system
      and i.engine = new.engine
      and i.error_code = new.error_code
  loop
    perform public.sync_reliability_improvement_for_learning_case(v_learning_id);
  end loop;
  return new;
end;
$$;

drop trigger if exists sync_reliability_improvement_from_policy
  on public.reliability_recovery_policies;
create trigger sync_reliability_improvement_from_policy
after insert or update of action, enabled, requires_approval, risk_level
on public.reliability_recovery_policies
for each row execute function public.sync_reliability_improvement_from_policy_trigger();

create or replace function public.log_reliability_improvement_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_type text;
  v_summary text;
begin
  if tg_op = 'INSERT' then
    v_event_type := 'created';
    v_summary := '반복 사건이 사용자용 개선 항목으로 등록되었습니다.';
  elsif old.status is not distinct from new.status then
    return new;
  else
    v_event_type := case new.status
      when 'policy_active' then 'policy_activated'
      when 'applied' then 'change_applied'
      when 'verified' then 'verified'
      when 'regressed' then 'regressed'
      when 'rejected' then 'rejected'
      when 'rolled_back' then 'rolled_back'
      else 'status_changed'
    end;
    v_summary := case new.status
      when 'analysis_pending' then 'AI 원인·해결·예방 분석을 기다리고 있습니다.'
      when 'implementation_needed' then '코드·검증·프롬프트 변경이 필요한 개선안으로 분류되었습니다.'
      when 'approval_required' then '고위험 또는 판단이 필요한 개선으로 승인 대기 중입니다.'
      when 'policy_active' then '기존 저위험 복구 정책이 향후 동일 오류 처리에 반영됩니다.'
      when 'applied' then '검증된 변경 또는 회귀 테스트가 실제 코드에 반영되었습니다.'
      when 'measuring' then '반영 후 오류율과 복구율을 비교 측정하고 있습니다.'
      when 'verified' then '반영 후 지표가 기준보다 개선된 것으로 확인되었습니다.'
      when 'neutral' then '반영 후 지표가 유의미하게 변하지 않았습니다.'
      when 'regressed' then '반영 후 지표가 악화되어 재검토가 필요합니다.'
      when 'rejected' then '개선안이 적용 대상에서 제외되었습니다.'
      when 'rolled_back' then '적용한 개선이 롤백되었습니다.'
      else '개선 상태가 변경되었습니다.'
    end;
  end if;

  insert into public.reliability_improvement_activity(
    improvement_id,
    event_type,
    from_status,
    to_status,
    summary,
    metadata
  ) values (
    new.id,
    v_event_type,
    case when tg_op = 'UPDATE' then old.status else null end,
    new.status,
    v_summary,
    jsonb_strip_nulls(jsonb_build_object(
      'applicationMode', new.application_mode,
      'safeAction', new.safe_action,
      'appliedReference', new.applied_reference
    ))
  );
  return new;
end;
$$;

drop trigger if exists log_reliability_improvement_activity
  on public.reliability_improvements;
create trigger log_reliability_improvement_activity
after insert or update of status
on public.reliability_improvements
for each row execute function public.log_reliability_improvement_activity();

do $$
declare
  v_learning_id uuid;
begin
  for v_learning_id in select id from public.reliability_learning_cases loop
    perform public.sync_reliability_improvement_for_learning_case(v_learning_id);
  end loop;
end;
$$;

alter table public.reliability_improvements enable row level security;
alter table public.reliability_improvement_activity enable row level security;

revoke all on table public.reliability_improvements from public, anon, authenticated;
revoke all on table public.reliability_improvement_activity from public, anon, authenticated;
grant all on table public.reliability_improvements to service_role;
grant all on table public.reliability_improvement_activity to service_role;

revoke all on function public.sync_reliability_improvement_for_learning_case(uuid)
  from public, anon, authenticated;
grant execute on function public.sync_reliability_improvement_for_learning_case(uuid)
  to service_role;
revoke all on function public.sync_reliability_improvement_from_learning_trigger()
  from public, anon, authenticated;
revoke all on function public.sync_reliability_improvement_from_regression_trigger()
  from public, anon, authenticated;
revoke all on function public.sync_reliability_improvement_from_policy_trigger()
  from public, anon, authenticated;
revoke all on function public.log_reliability_improvement_activity()
  from public, anon, authenticated;

comment on table public.reliability_improvements is
  'User-readable ledger linking learned incidents to actual policy/code application and measured effect.';
comment on table public.reliability_improvement_activity is
  'Plain-language timeline of how each learned incident moved from analysis to application and verification.';
comment on function public.sync_reliability_improvement_for_learning_case(uuid) is
  'Promotes a completed learning case into an honest improvement lifecycle without claiming code changes that have not happened.';

commit;
