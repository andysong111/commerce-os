begin;

create or replace function public.guard_reliability_github_application_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.regression_case_id is not null
     and new.regression_case_id is null
     and old.application_mode = 'github_change' then
    new.application_mode := 'none';
    new.applied_at := null;
    new.applied_reference := null;
    new.requires_approval := true;
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'applicationEvidenceActive', false,
      'measurementBaselineAvailable', false,
      'measurementReason', 'linked regression evidence row was deleted'
    );
    return new;
  end if;

  if old.application_mode = 'github_change'
     and new.application_mode = 'github_change'
     and old.applied_at is not null
     and old.applied_reference is not distinct from new.applied_reference then
    new.applied_at := old.applied_at;
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'applicationTimestampPreserved', true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists yy_guard_reliability_github_application_evidence
  on public.reliability_improvements;
create trigger yy_guard_reliability_github_application_evidence
before update of
  regression_case_id,
  application_mode,
  applied_at,
  applied_reference
on public.reliability_improvements
for each row execute function public.guard_reliability_github_application_evidence();

update public.reliability_improvements
set application_mode = application_mode
where application_mode = 'github_change';

revoke all on function public.guard_reliability_github_application_evidence()
  from public, anon, authenticated;

comment on function public.guard_reliability_github_application_evidence() is
  'Keeps applied_at stable for the same qualifying commit and revokes application evidence when the linked regression row is deleted.';

commit;
