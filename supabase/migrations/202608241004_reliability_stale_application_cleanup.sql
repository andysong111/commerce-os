begin;

create or replace function public.clear_stale_reliability_application_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.application_mode = 'none'
     and new.applied_at is null
     and (
       old.application_mode in ('existing_policy','automatic_policy','github_change','manual_change')
       or old.applied_at is not null
       or old.status in ('applied','measuring','verified','neutral','regressed')
       or coalesce((old.metadata->>'applicationEvidenceActive')::boolean, false)
     ) then
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
      when new.risk_level in ('high','critical') then 'approval_required'
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

drop trigger if exists zz_clear_stale_reliability_application_evidence
  on public.reliability_improvements;
create trigger zz_clear_stale_reliability_application_evidence
before update of
  application_mode,
  policy_id,
  regression_case_id,
  applied_at,
  status,
  measurement_result,
  metadata
on public.reliability_improvements
for each row execute function public.clear_stale_reliability_application_evidence();

update public.reliability_improvements
set status = status;

revoke all on function public.clear_stale_reliability_application_evidence()
  from public, anon, authenticated;

comment on function public.clear_stale_reliability_application_evidence() is
  'Removes stale application, measurement, and metadata claims after a qualifying policy or commit is withdrawn.';

commit;
