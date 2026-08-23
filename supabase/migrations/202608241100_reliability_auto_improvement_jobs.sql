begin;

create table if not exists public.reliability_auto_improvement_jobs (
  id uuid primary key default gen_random_uuid(),
  improvement_id uuid not null unique references public.reliability_improvements(id) on delete cascade,
  source_system text not null,
  engine text not null,
  error_code text,
  target_repo text not null,
  safe_surface text,
  mode text not null check (mode in ('auto','approval','blocked')),
  risk_level text not null check (risk_level in ('low','medium','high','critical')),
  status text not null check (status in (
    'queued','planning','ready','patch_created','validating','preview_passed',
    'merged','production_verified','approval_required','blocked','failed','rolled_back'
  )),
  allowed_paths jsonb not null default '[]'::jsonb,
  plan jsonb not null default '{}'::jsonb,
  validation jsonb not null default '{}'::jsonb,
  branch_name text,
  pr_number bigint,
  head_sha text,
  merge_sha text,
  preview_url text,
  production_url text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  not_before timestamptz not null default now(),
  lease_token uuid,
  lease_runner text,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reliability_auto_improvement_jobs_status_idx
  on public.reliability_auto_improvement_jobs(status, not_before, updated_at desc);
create index if not exists reliability_auto_improvement_jobs_repo_idx
  on public.reliability_auto_improvement_jobs(target_repo, status, not_before);

create table if not exists public.reliability_auto_improvement_activity (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.reliability_auto_improvement_jobs(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  summary text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists reliability_auto_improvement_activity_job_idx
  on public.reliability_auto_improvement_activity(job_id, occurred_at desc);

alter table public.reliability_auto_improvement_jobs enable row level security;
alter table public.reliability_auto_improvement_activity enable row level security;
revoke all on table public.reliability_auto_improvement_jobs from public, anon, authenticated;
revoke all on table public.reliability_auto_improvement_activity from public, anon, authenticated;
grant select, insert, update, delete on table public.reliability_auto_improvement_jobs to service_role;
grant select, insert, update, delete on table public.reliability_auto_improvement_activity to service_role;

create or replace function public.sync_reliability_auto_improvement_job(p_improvement_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.reliability_improvements%rowtype;
  v_target_repo text;
  v_surface text;
  v_mode text;
  v_status text;
  v_paths jsonb := '[]'::jsonb;
  v_id uuid;
  v_existing_status text;
begin
  select * into v from public.reliability_improvements where id = p_improvement_id;
  if not found then return null; end if;

  if v.status not in ('implementation_needed','approval_required') then
    return null;
  end if;

  v_target_repo := case
    when v.source_system = 'ai-saurus' then 'andysong111/commerce-os-detail-page-saas'
    when v.source_system = 'commerce-os' then 'andysong111/commerce-os-ops-center'
    else ''
  end;

  if v.status = 'approval_required' or v.risk_level in ('medium','high','critical') then
    v_mode := 'approval';
    v_status := 'approval_required';
  elsif v.source_system = 'ai-saurus'
    and v.engine = 'detail-page-generation'
    and coalesce(v.error_code,'') = 'SERVER_FINALIZATION_FAILED'
    and v.safe_action = 'retry'
    and v.risk_level = 'low'
    and v.confidence >= 0.60 then
    v_mode := 'auto';
    v_status := 'queued';
    v_surface := 'ai_saurus_server_finalization_retry_v1';
    v_paths := jsonb_build_array(
      'src/config/saasServerFinalizationRetryPolicy.json',
      'src/lib/saasServerFinalizerRetry.test.ts'
    );
  else
    v_mode := 'blocked';
    v_status := 'blocked';
  end if;

  if v_target_repo = '' then
    v_mode := 'blocked';
    v_status := 'blocked';
  end if;

  select status into v_existing_status
  from public.reliability_auto_improvement_jobs
  where improvement_id = v.id;

  insert into public.reliability_auto_improvement_jobs(
    improvement_id, source_system, engine, error_code, target_repo,
    safe_surface, mode, risk_level, status, allowed_paths, last_error
  ) values (
    v.id, v.source_system, v.engine, v.error_code, v_target_repo,
    v_surface, v_mode, v.risk_level, v_status, v_paths,
    case when v_mode = 'blocked' then '자동수정 안전구역이 아직 등록되지 않았습니다.' else null end
  )
  on conflict (improvement_id) do update set
    source_system = excluded.source_system,
    engine = excluded.engine,
    error_code = excluded.error_code,
    target_repo = excluded.target_repo,
    safe_surface = excluded.safe_surface,
    mode = excluded.mode,
    risk_level = excluded.risk_level,
    status = case
      when public.reliability_auto_improvement_jobs.status in ('production_verified','rolled_back')
        then public.reliability_auto_improvement_jobs.status
      when public.reliability_auto_improvement_jobs.status in (
        'planning','ready','patch_created','validating','preview_passed','merged'
      ) and excluded.mode = 'auto'
        then public.reliability_auto_improvement_jobs.status
      else excluded.status
    end,
    allowed_paths = excluded.allowed_paths,
    last_error = case
      when excluded.mode = 'blocked' then excluded.last_error
      when public.reliability_auto_improvement_jobs.status in ('failed','blocked','approval_required') then null
      else public.reliability_auto_improvement_jobs.last_error
    end,
    updated_at = now()
  returning id into v_id;

  if v_existing_status is null then
    insert into public.reliability_auto_improvement_activity(
      job_id, event_type, to_status, summary
    ) values (
      v_id,
      'created',
      v_status,
      case v_mode
        when 'auto' then '안전한 자동수정 후보로 등록했습니다.'
        when 'approval' then '사람의 확인이 필요한 개선으로 분류했습니다.'
        else '자동수정 안전구역 밖이라 변경하지 않습니다.'
      end
    );
  end if;

  return v_id;
end;
$$;

create or replace function public.sync_reliability_auto_improvement_from_improvement_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_reliability_auto_improvement_job(new.id);
  return new;
end;
$$;

drop trigger if exists sync_reliability_auto_improvement_from_improvement
  on public.reliability_improvements;
create trigger sync_reliability_auto_improvement_from_improvement
after insert or update of status, risk_level, confidence, safe_action, error_code, source_system, engine
on public.reliability_improvements
for each row execute function public.sync_reliability_auto_improvement_from_improvement_trigger();

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
      lease_expires_at = now() + interval '60 minutes',
      last_error = null,
      updated_at = now()
  where id = v_id;

  insert into public.reliability_auto_improvement_activity(
    job_id, event_type, from_status, to_status, summary,
    metadata
  ) values (
    v_id, 'claimed', 'queued', 'planning', '자동수정 계획을 만들기 시작했습니다.',
    jsonb_build_object('runner', left(coalesce(p_runner,''), 200))
  );

  select to_jsonb(j) || jsonb_build_object(
    'improvement', to_jsonb(i)
  ) into v_job
  from public.reliability_auto_improvement_jobs j
  join public.reliability_improvements i on i.id = j.improvement_id
  where j.id = v_id;

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
  v_count integer;
begin
  update public.reliability_auto_improvement_jobs
  set status = case when attempt_count < max_attempts then 'failed' else 'blocked' end,
      not_before = now() + interval '30 minutes',
      lease_token = null,
      lease_runner = null,
      lease_expires_at = null,
      last_error = '자동수정 실행이 완료 보고 없이 종료되어 안전하게 회수했습니다.',
      updated_at = now()
  where status in ('planning','ready','patch_created','validating','preview_passed','merged')
    and lease_expires_at is not null
    and lease_expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

select public.sync_reliability_auto_improvement_job(id)
from public.reliability_improvements
where status in ('implementation_needed','approval_required');

revoke all on function public.sync_reliability_auto_improvement_job(uuid)
  from public, anon, authenticated;
revoke all on function public.claim_reliability_auto_improvement_job(text,text)
  from public, anon, authenticated;
revoke all on function public.requeue_expired_reliability_auto_improvement_jobs()
  from public, anon, authenticated;
grant execute on function public.sync_reliability_auto_improvement_job(uuid) to service_role;
grant execute on function public.claim_reliability_auto_improvement_job(text,text) to service_role;
grant execute on function public.requeue_expired_reliability_auto_improvement_jobs() to service_role;

comment on table public.reliability_auto_improvement_jobs is
  'Guarded queue for low-risk self-improvement. Auto mode is limited to explicit data-only safe surfaces.';
comment on function public.claim_reliability_auto_improvement_job(text,text) is
  'Claims one allowlisted low-risk auto-improvement job for an authenticated repository runner.';

commit;