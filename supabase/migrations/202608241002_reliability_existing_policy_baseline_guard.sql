begin;

create or replace function public.guard_reliability_improvement_measurement_baseline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy_created_at timestamptz;
  v_learning_created_at timestamptz;
begin
  if new.application_mode <> 'existing_policy' or new.policy_id is null then
    return new;
  end if;

  select p.created_at, l.created_at
  into v_policy_created_at, v_learning_created_at
  from public.reliability_recovery_policies p
  join public.reliability_learning_cases l on l.id = new.learning_case_id
  where p.id = new.policy_id;

  if v_policy_created_at is null or v_learning_created_at is null then
    return new;
  end if;

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
      'measurementBaselineAvailable', false,
      'measurementReason', 'existing policy predates the learned incident'
    );
  else
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'measurementBaselineAvailable', true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists guard_reliability_improvement_measurement_baseline
  on public.reliability_improvements;
create trigger guard_reliability_improvement_measurement_baseline
before insert or update of
  application_mode,
  policy_id,
  learning_case_id,
  applied_at,
  status,
  measurement_result
on public.reliability_improvements
for each row execute function public.guard_reliability_improvement_measurement_baseline();

update public.reliability_improvements
set application_mode = application_mode
where application_mode = 'existing_policy';

delete from public.reliability_improvement_activity a
using public.reliability_improvements i
where a.improvement_id = i.id
  and i.application_mode = 'existing_policy'
  and i.applied_at is null
  and a.event_type = 'measurement_updated';

revoke all on function public.guard_reliability_improvement_measurement_baseline()
  from public, anon, authenticated;

comment on function public.guard_reliability_improvement_measurement_baseline() is
  'Prevents a preexisting recovery policy from being misrepresented as a newly applied improvement with a measurable before/after baseline.';

commit;
