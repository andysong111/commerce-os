begin;

create or replace function public.guard_reliability_improvement_measurement_baseline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_learning_created_at timestamptz;
  v_policy_created_at timestamptz;
  v_policy_enabled boolean := false;
  v_policy_requires_approval boolean := false;
  v_policy_risk_level text;
  v_policy_action text;
  v_regression_status text;
  v_regression_commit_sha text;
  v_regression_updated_at timestamptz;
  v_regression_qualifies boolean := false;
  v_policy_qualifies boolean := false;
begin
  select created_at
  into v_learning_created_at
  from public.reliability_learning_cases
  where id = new.learning_case_id;

  if new.regression_case_id is not null then
    select status, commit_sha, updated_at
    into v_regression_status, v_regression_commit_sha, v_regression_updated_at
    from public.reliability_regression_cases
    where id = new.regression_case_id;

    v_regression_qualifies :=
      v_regression_status in ('implemented','passing')
      and nullif(v_regression_commit_sha,'') is not null;
  end if;

  if new.policy_id is not null then
    select created_at, enabled, requires_approval, risk_level, action
    into
      v_policy_created_at,
      v_policy_enabled,
      v_policy_requires_approval,
      v_policy_risk_level,
      v_policy_action
    from public.reliability_recovery_policies
    where id = new.policy_id;

    v_policy_qualifies :=
      coalesce(v_policy_enabled, false)
      and not coalesce(v_policy_requires_approval, true)
      and coalesce(v_policy_risk_level, 'high') not in ('high','critical')
      and new.safe_action <> 'none';
  end if;

  if v_regression_qualifies then
    new.application_mode := 'github_change';
    new.applied_at := v_regression_updated_at;
    new.applied_reference := concat('commit:', v_regression_commit_sha);
    new.requires_approval := false;
    if new.measurement_result = 'not_started'
       and new.status not in ('measuring','verified','neutral','regressed') then
      new.status := 'applied';
    end if;
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'applicationEvidenceActive', true,
      'measurementBaselineAvailable', true,
      'applicationEvidenceType', 'github_commit'
    );
    return new;
  end if;

  if v_policy_qualifies then
    new.application_mode := 'existing_policy';
    new.policy_action := v_policy_action;
    new.applied_reference := concat('recovery-policy:', new.policy_id::text);
    new.requires_approval := false;

    if v_policy_created_at < v_learning_created_at then
      new.applied_at := null;
      new.status := 'policy_active';
      new.baseline_started_at := null;
      new.baseline_ended_at := null;
      new.current_started_at := null;
      new.current_ended_at := null;
      new.baseline_events := 0;
      new.baseline_failures := 0;
      new.baseline_recoveries := 0;
      new.current_events := 0;
      new.current_failures := 0;
      new.current_recoveries := 0;
      new.baseline_failure_rate := null;
      new.current_failure_rate := null;
      new.current_recovery_rate := null;
      new.improvement_percent := null;
      new.measurement_result := 'not_started';
      new.last_measured_at := null;
      new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
        'applicationEvidenceActive', true,
        'measurementBaselineAvailable', false,
        'measurementReason', 'existing policy predates the learned incident',
        'applicationEvidenceType', 'preexisting_policy'
      );
    else
      new.applied_at := v_policy_created_at;
      if new.measurement_result = 'not_started'
         and new.status not in ('measuring','verified','neutral','regressed') then
        new.status := 'policy_active';
      end if;
      new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
        'applicationEvidenceActive', true,
        'measurementBaselineAvailable', true,
        'applicationEvidenceType', 'new_policy'
      );
    end if;
    return new;
  end if;

  if new.application_mode in ('existing_policy','automatic_policy','github_change')
     or new.applied_at is not null then
    new.application_mode := 'none';
    new.applied_at := null;
    new.applied_reference := null;
    new.baseline_started_at := null;
    new.baseline_ended_at := null;
    new.current_started_at := null;
    new.current_ended_at := null;
    new.baseline_events := 0;
    new.baseline_failures := 0;
    new.baseline_recoveries := 0;
    new.current_events := 0;
    new.current_failures := 0;
    new.current_recoveries := 0;
    new.baseline_failure_rate := null;
    new.current_failure_rate := null;
    new.current_recovery_rate := null;
    new.improvement_percent := null;
    new.measurement_result := 'not_started';
    new.last_measured_at := null;
    new.requires_approval := true;
    new.status := case
      when nullif(new.root_cause,'') is null
        or nullif(new.change_summary,'') is null
        or nullif(new.prevention_rule,'') is null then 'analysis_pending'
      when new.risk_level in ('high','critical')
        or coalesce(v_policy_requires_approval, false)
        or coalesce(v_policy_risk_level, 'low') in ('high','critical') then 'approval_required'
      else 'implementation_needed'
    end;
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'applicationEvidenceActive', false,
      'measurementBaselineAvailable', false,
      'measurementReason', 'qualifying policy or commit is no longer active'
    );
  end if;

  return new;
end;
$$;

create or replace function public.refresh_reliability_improvement_measurements()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.reliability_improvements%rowtype;
  v_duration interval;
  v_baseline_start timestamptz;
  v_baseline_end timestamptz;
  v_current_start timestamptz;
  v_current_end timestamptz;
  v_baseline_events bigint;
  v_baseline_failures bigint;
  v_baseline_recoveries bigint;
  v_current_events bigint;
  v_current_failures bigint;
  v_current_recoveries bigint;
  v_baseline_rate numeric;
  v_current_rate numeric;
  v_current_recovery_rate numeric;
  v_improvement_percent numeric;
  v_measurement_result text;
  v_next_status text;
  v_processed integer := 0;
  v_verified integer := 0;
  v_regressed integer := 0;
  v_measuring integer := 0;
begin
  for r in
    select *
    from public.reliability_improvements
    where applied_at is not null
      and status in ('policy_active','applied','measuring','verified','neutral','regressed')
      and coalesce((metadata->>'applicationEvidenceActive')::boolean, true)
      and coalesce((metadata->>'measurementBaselineAvailable')::boolean, true)
    order by applied_at asc
  loop
    v_duration := least(
      interval '7 days',
      greatest(interval '1 hour', now() - r.applied_at)
    );
    v_baseline_start := r.applied_at - v_duration;
    v_baseline_end := r.applied_at;
    v_current_start := r.applied_at;
    v_current_end := least(now(), r.applied_at + v_duration);

    select
      count(distinct coalesce(e.run_id, e.id::text)),
      count(distinct coalesce(e.run_id, e.id::text)) filter (
        where e.incident_id = r.incident_id
          and e.status in ('failed','blocked','retrying','quality_rejected')
      ),
      count(distinct coalesce(e.run_id, e.id::text)) filter (
        where e.incident_id = r.incident_id
          and e.status = 'recovered'
      )
    into v_baseline_events, v_baseline_failures, v_baseline_recoveries
    from public.reliability_events e
    where e.source_system = r.source_system
      and e.engine = r.engine
      and e.occurred_at >= v_baseline_start
      and e.occurred_at < v_baseline_end;

    select
      count(distinct coalesce(e.run_id, e.id::text)),
      count(distinct coalesce(e.run_id, e.id::text)) filter (
        where e.incident_id = r.incident_id
          and e.status in ('failed','blocked','retrying','quality_rejected')
      ),
      count(distinct coalesce(e.run_id, e.id::text)) filter (
        where e.incident_id = r.incident_id
          and e.status = 'recovered'
      )
    into v_current_events, v_current_failures, v_current_recoveries
    from public.reliability_events e
    where e.source_system = r.source_system
      and e.engine = r.engine
      and e.occurred_at >= v_current_start
      and e.occurred_at <= v_current_end;

    v_baseline_rate := case
      when v_baseline_events > 0
        then v_baseline_failures::numeric / v_baseline_events::numeric
      else null
    end;
    v_current_rate := case
      when v_current_events > 0
        then v_current_failures::numeric / v_current_events::numeric
      else null
    end;
    v_current_recovery_rate := case
      when v_current_failures > 0
        then least(1, v_current_recoveries::numeric / v_current_failures::numeric)
      when v_current_events > 0 then 0
      else null
    end;

    if v_duration < interval '24 hours'
       or v_baseline_events < 5
       or v_current_events < 5
       or v_baseline_failures < 1
       or v_baseline_rate is null
       or v_current_rate is null then
      v_improvement_percent := null;
      v_measurement_result := 'insufficient_data';
      v_next_status := 'measuring';
      v_measuring := v_measuring + 1;
    else
      v_improvement_percent := round(
        ((v_baseline_rate - v_current_rate) / nullif(v_baseline_rate, 0)) * 100,
        2
      );
      if v_improvement_percent >= 20 then
        v_measurement_result := 'improved';
        v_next_status := 'verified';
        v_verified := v_verified + 1;
      elsif v_improvement_percent <= -20 then
        v_measurement_result := 'regressed';
        v_next_status := 'regressed';
        v_regressed := v_regressed + 1;
      else
        v_measurement_result := 'unchanged';
        v_next_status := 'neutral';
      end if;
    end if;

    update public.reliability_improvements
    set baseline_started_at = v_baseline_start,
        baseline_ended_at = v_baseline_end,
        current_started_at = v_current_start,
        current_ended_at = v_current_end,
        baseline_events = v_baseline_events,
        baseline_failures = v_baseline_failures,
        baseline_recoveries = v_baseline_recoveries,
        current_events = v_current_events,
        current_failures = v_current_failures,
        current_recoveries = v_current_recoveries,
        baseline_failure_rate = v_baseline_rate,
        current_failure_rate = v_current_rate,
        current_recovery_rate = v_current_recovery_rate,
        improvement_percent = v_improvement_percent,
        measurement_result = v_measurement_result,
        status = v_next_status,
        last_measured_at = now(),
        metadata = metadata || jsonb_build_object(
          'measurementWindowHours', round(extract(epoch from v_duration) / 3600.0, 2),
          'measurementMethod', 'linked incident failures per distinct engine run before versus after application'
        ),
        updated_at = now()
    where id = r.id;

    if r.measurement_result is distinct from v_measurement_result then
      insert into public.reliability_improvement_activity(
        improvement_id,
        event_type,
        from_status,
        to_status,
        summary,
        metadata
      ) values (
        r.id,
        'measurement_updated',
        r.status,
        v_next_status,
        case v_measurement_result
          when 'improved' then '적용 전보다 해당 사건의 실행 비율이 20% 이상 낮아졌습니다.'
          when 'regressed' then '적용 전보다 해당 사건의 실행 비율이 20% 이상 높아져 재검토가 필요합니다.'
          when 'unchanged' then '적용 전후 차이가 아직 유의미하지 않습니다.'
          else '공정한 전후 비교를 위한 실행 표본을 더 수집하고 있습니다.'
        end,
        jsonb_strip_nulls(jsonb_build_object(
          'incidentId', r.incident_id,
          'baselineEvents', v_baseline_events,
          'baselineFailures', v_baseline_failures,
          'currentEvents', v_current_events,
          'currentFailures', v_current_failures,
          'currentRecoveries', v_current_recoveries,
          'improvementPercent', v_improvement_percent
        ))
      );
    end if;

    v_processed := v_processed + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'processed', v_processed,
    'verified', v_verified,
    'regressed', v_regressed,
    'measuring', v_measuring,
    'measuredAt', now()
  );
end;
$$;

update public.reliability_improvements
set status = status;

select public.refresh_reliability_improvement_measurements();

revoke all on function public.guard_reliability_improvement_measurement_baseline()
  from public, anon, authenticated;
revoke all on function public.refresh_reliability_improvement_measurements()
  from public, anon, authenticated;
grant execute on function public.refresh_reliability_improvement_measurements()
  to service_role;

comment on function public.guard_reliability_improvement_measurement_baseline() is
  'Revalidates current policy or commit evidence, clears stale application claims, and blocks retrospective measurement of preexisting policies.';
comment on function public.refresh_reliability_improvement_measurements() is
  'Measures the linked incident rate per distinct engine run before and after a currently active, newly measurable application.';

commit;
