-- Stage 6: validation-only load verification, audit events, and safe archiving.
-- Apply manually only after PR review and Preview verification.

alter table public.shopling_price_bulk_jobs
  drop constraint if exists shopling_price_bulk_jobs_status_check;

alter table public.shopling_price_bulk_jobs
  add constraint shopling_price_bulk_jobs_status_check
  check (status in (
    'prepared',
    'validation_only',
    'canary_dispatching',
    'canary_running',
    'canary_succeeded',
    'canary_failed',
    'normal_running',
    'normal_paused',
    'normal_succeeded',
    'normal_failed',
    'retry_running',
    'retry_paused',
    'retry_failed',
    'dispatch_uncertain',
    'cancelled'
  ));

alter table public.shopling_price_bulk_jobs
  drop constraint if exists shopling_price_bulk_jobs_input_source_check;

alter table public.shopling_price_bulk_jobs
  add constraint shopling_price_bulk_jobs_input_source_check
  check (input_source in ('paste', 'csv', 'xlsx', 'validation_only'));

alter table public.shopling_price_bulk_jobs
  add column if not exists execution_mode text not null default 'live',
  add column if not exists archived_at timestamptz,
  add column if not exists archive_note text,
  add column if not exists archive_previous_status text;

alter table public.shopling_price_bulk_jobs
  drop constraint if exists shopling_price_bulk_jobs_execution_mode_check;

alter table public.shopling_price_bulk_jobs
  add constraint shopling_price_bulk_jobs_execution_mode_check
  check (execution_mode in ('live', 'validation_only'));

alter table public.shopling_price_bulk_jobs
  drop constraint if exists shopling_price_bulk_jobs_validation_mode_check;

alter table public.shopling_price_bulk_jobs
  add constraint shopling_price_bulk_jobs_validation_mode_check
  check (status <> 'validation_only' or execution_mode = 'validation_only');

create index if not exists shopling_price_bulk_jobs_owner_archive_created
  on public.shopling_price_bulk_jobs(owner_id, archived_at, created_at desc);

create table if not exists public.shopling_price_bulk_audit_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.shopling_price_bulk_jobs(id) on delete cascade,
  owner_id uuid not null,
  entity_type text not null check (entity_type in ('job', 'chunk')),
  entity_id text not null,
  event_type text not null,
  old_status text,
  new_status text,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists shopling_price_bulk_audit_job_id_id
  on public.shopling_price_bulk_audit_events(job_id, id desc);
create index if not exists shopling_price_bulk_audit_owner_created
  on public.shopling_price_bulk_audit_events(owner_id, created_at desc);

alter table public.shopling_price_bulk_audit_events enable row level security;
revoke all on public.shopling_price_bulk_audit_events from public, anon, authenticated;
grant select, insert on public.shopling_price_bulk_audit_events to service_role;
grant usage, select on sequence public.shopling_price_bulk_audit_events_id_seq to service_role;

create or replace function public.log_shopling_price_bulk_job_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.shopling_price_bulk_audit_events(
      job_id, owner_id, entity_type, entity_id, event_type, new_status, metadata
    ) values (
      new.id,
      new.owner_id,
      'job',
      new.id::text,
      'job_created',
      new.status,
      jsonb_build_object(
        'valid_count', new.valid_count,
        'total_chunk_count', new.total_chunk_count
      )
    );
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.shopling_price_bulk_audit_events(
      job_id, owner_id, entity_type, entity_id, event_type, old_status, new_status, metadata
    ) values (
      new.id,
      new.owner_id,
      'job',
      new.id::text,
      'job_status_changed',
      old.status,
      new.status,
      jsonb_build_object(
        'retry_round', coalesce(new.retry_round, 0),
        'pause_requested', coalesce(new.pause_requested, false)
      )
    );
  end if;

  if new.pause_requested is distinct from old.pause_requested then
    insert into public.shopling_price_bulk_audit_events(
      job_id, owner_id, entity_type, entity_id, event_type, old_status, new_status, metadata
    ) values (
      new.id,
      new.owner_id,
      'job',
      new.id::text,
      'pause_changed',
      old.status,
      new.status,
      jsonb_build_object('pause_requested', coalesce(new.pause_requested, false))
    );
  end if;

  if new.retry_round is distinct from old.retry_round then
    insert into public.shopling_price_bulk_audit_events(
      job_id, owner_id, entity_type, entity_id, event_type, old_status, new_status, metadata
    ) values (
      new.id,
      new.owner_id,
      'job',
      new.id::text,
      'retry_round_changed',
      old.status,
      new.status,
      jsonb_build_object('retry_round', coalesce(new.retry_round, 0))
    );
  end if;

  if new.archived_at is distinct from old.archived_at then
    insert into public.shopling_price_bulk_audit_events(
      job_id, owner_id, entity_type, entity_id, event_type, old_status, new_status, metadata
    ) values (
      new.id,
      new.owner_id,
      'job',
      new.id::text,
      case when new.archived_at is null then 'job_restored' else 'job_archived' end,
      old.status,
      new.status,
      jsonb_build_object('archived', new.archived_at is not null)
    );
  end if;

  return new;
end;
$$;

create or replace function public.log_shopling_price_bulk_chunk_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  select owner_id into v_owner_id
  from public.shopling_price_bulk_jobs
  where id = new.job_id;

  if v_owner_id is null then
    raise exception 'audit owner not found';
  end if;

  if tg_op = 'INSERT' then
    insert into public.shopling_price_bulk_audit_events(
      job_id, owner_id, entity_type, entity_id, event_type, new_status, request_id, metadata
    ) values (
      new.job_id,
      v_owner_id,
      'chunk',
      new.id::text,
      'chunk_created',
      new.status,
      new.request_id,
      jsonb_build_object(
        'chunk_index', new.chunk_index,
        'chunk_type', new.chunk_type,
        'goods_key_count', new.goods_key_count,
        'retry_round', coalesce(new.retry_round, 0),
        'attempt_count', new.attempt_count
      )
    );
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.shopling_price_bulk_audit_events(
      job_id, owner_id, entity_type, entity_id, event_type, old_status, new_status, request_id, metadata
    ) values (
      new.job_id,
      v_owner_id,
      'chunk',
      new.id::text,
      'chunk_status_changed',
      old.status,
      new.status,
      new.request_id,
      jsonb_build_object(
        'chunk_index', new.chunk_index,
        'chunk_type', new.chunk_type,
        'retry_round', coalesce(new.retry_round, 0),
        'attempt_count', new.attempt_count
      )
    );
  end if;

  if new.request_id is distinct from old.request_id and new.request_id is not null then
    insert into public.shopling_price_bulk_audit_events(
      job_id, owner_id, entity_type, entity_id, event_type, old_status, new_status, request_id, metadata
    ) values (
      new.job_id,
      v_owner_id,
      'chunk',
      new.id::text,
      'request_assigned',
      old.status,
      new.status,
      new.request_id,
      jsonb_build_object(
        'chunk_index', new.chunk_index,
        'chunk_type', new.chunk_type,
        'retry_round', coalesce(new.retry_round, 0),
        'attempt_count', new.attempt_count
      )
    );
  end if;

  return new;
end;
$$;

revoke all on function public.log_shopling_price_bulk_job_audit() from public, anon, authenticated;
revoke all on function public.log_shopling_price_bulk_chunk_audit() from public, anon, authenticated;

drop trigger if exists shopling_price_bulk_job_audit_trigger on public.shopling_price_bulk_jobs;
create trigger shopling_price_bulk_job_audit_trigger
after insert or update on public.shopling_price_bulk_jobs
for each row execute function public.log_shopling_price_bulk_job_audit();

drop trigger if exists shopling_price_bulk_chunk_audit_trigger on public.shopling_price_bulk_chunks;
create trigger shopling_price_bulk_chunk_audit_trigger
after insert or update on public.shopling_price_bulk_chunks
for each row execute function public.log_shopling_price_bulk_chunk_audit();

create or replace function public.create_shopling_price_bulk_validation_job(
  p_owner_id uuid,
  p_count integer default 20000
) returns public.shopling_price_bulk_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.shopling_price_bulk_jobs;
  v_chunk_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_owner_id is null then
    raise exception 'owner required';
  end if;
  if p_count <> 20000 then
    raise exception 'validation count must be exactly 20000';
  end if;

  v_chunk_count := 1 + ceil(greatest(p_count - 10, 0) / 50.0)::integer;

  insert into public.shopling_price_bulk_jobs(
    owner_id,
    status,
    input_source,
    original_count,
    valid_count,
    duplicate_count,
    invalid_count,
    canary_size,
    normal_chunk_size,
    total_chunk_count,
    policy_overrides,
    execution_mode
  ) values (
    p_owner_id,
    'validation_only',
    'validation_only',
    p_count,
    p_count,
    0,
    0,
    10,
    50,
    v_chunk_count,
    '[]'::jsonb,
    'validation_only'
  ) returning * into v_job;

  insert into public.shopling_price_bulk_items(
    job_id, goods_key, ordinal, is_canary, status, attempt_count
  )
  select
    v_job.id,
    (990000000000::bigint + ordinal)::text,
    ordinal,
    ordinal <= 10,
    'pending',
    0
  from generate_series(1, p_count) ordinal;

  insert into public.shopling_price_bulk_chunks(
    job_id, chunk_index, chunk_type, goods_keys, goods_key_count, status, attempt_count
  )
  select
    v_job.id,
    chunk_index,
    case when chunk_index = 0 then 'canary' else 'normal' end,
    to_jsonb(array_agg(goods_key order by ordinal)),
    count(*)::integer,
    'pending',
    0
  from (
    select
      (990000000000::bigint + ordinal)::text as goods_key,
      ordinal,
      case when ordinal <= 10 then 0 else 1 + ((ordinal - 11) / 50)::integer end as chunk_index
    from generate_series(1, p_count) ordinal
  ) seeds
  group by chunk_index
  order by chunk_index;

  return v_job;
end;
$$;

create or replace function public.archive_shopling_price_bulk_job(
  p_job_id uuid,
  p_owner_id uuid,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.shopling_price_bulk_jobs;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  select * into v_job
  from public.shopling_price_bulk_jobs
  where id = p_job_id and owner_id = p_owner_id
  for update;

  if v_job.id is null then raise exception 'job not found'; end if;
  if v_job.archived_at is not null then raise exception 'job already archived'; end if;
  if exists (
    select 1 from public.shopling_price_bulk_chunks
    where job_id = p_job_id and status in ('dispatching', 'running', 'dispatch_uncertain')
  ) then raise exception 'active chunk exists'; end if;

  if v_job.status not in (
    'prepared', 'validation_only', 'canary_succeeded', 'canary_failed',
    'normal_succeeded', 'normal_failed', 'retry_failed', 'cancelled'
  ) then
    raise exception 'job status cannot be archived';
  end if;

  if v_job.status = 'canary_succeeded' and exists (
    select 1 from public.shopling_price_bulk_chunks
    where job_id = p_job_id
      and chunk_type = 'normal'
      and status in ('pending', 'dispatching', 'running', 'dispatch_uncertain')
  ) then
    raise exception 'pending normal chunk exists';
  end if;

  update public.shopling_price_bulk_jobs
  set archive_previous_status = status,
      status = 'cancelled',
      archived_at = now(),
      archive_note = left(nullif(trim(coalesce(p_note, '')), ''), 500),
      updated_at = now()
  where id = p_job_id and owner_id = p_owner_id;

  return jsonb_build_object('job_id', p_job_id, 'status', 'cancelled', 'archived', true);
end;
$$;

create or replace function public.restore_shopling_price_bulk_job(
  p_job_id uuid,
  p_owner_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.shopling_price_bulk_jobs;
  v_status text;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  select * into v_job
  from public.shopling_price_bulk_jobs
  where id = p_job_id and owner_id = p_owner_id
  for update;

  if v_job.id is null then raise exception 'job not found'; end if;
  if v_job.archived_at is null then raise exception 'job is not archived'; end if;
  if v_job.archive_previous_status is null then raise exception 'archive previous status missing'; end if;

  v_status := v_job.archive_previous_status;

  update public.shopling_price_bulk_jobs
  set status = v_status,
      archived_at = null,
      archive_note = null,
      archive_previous_status = null,
      updated_at = now()
  where id = p_job_id and owner_id = p_owner_id;

  return jsonb_build_object('job_id', p_job_id, 'status', v_status, 'archived', false);
end;
$$;

create or replace function public.archive_stale_shopling_price_bulk_jobs(
  p_owner_id uuid,
  p_older_than_days integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  if p_older_than_days < 7 or p_older_than_days > 365 then
    raise exception 'older_than_days must be between 7 and 365';
  end if;

  with candidates as (
    select job.id
    from public.shopling_price_bulk_jobs job
    where job.owner_id = p_owner_id
      and job.archived_at is null
      and job.status in ('prepared', 'validation_only')
      and job.updated_at < now() - make_interval(days => p_older_than_days)
      and not exists (
        select 1
        from public.shopling_price_bulk_chunks chunk
        where chunk.job_id = job.id
          and (
            chunk.status <> 'pending'
            or chunk.attempt_count > 0
            or chunk.started_at is not null
          )
      )
    for update skip locked
  ), archived as (
    update public.shopling_price_bulk_jobs job
    set archive_previous_status = job.status,
        status = 'cancelled',
        archived_at = now(),
        archive_note = 'stale prepared/validation job archived after ' || p_older_than_days || ' days',
        updated_at = now()
    from candidates
    where job.id = candidates.id
    returning job.id
  )
  select count(*)::integer into v_count from archived;

  return jsonb_build_object('archived_count', v_count, 'older_than_days', p_older_than_days);
end;
$$;

revoke all on function public.create_shopling_price_bulk_validation_job(uuid,integer) from public, anon, authenticated;
revoke all on function public.archive_shopling_price_bulk_job(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.restore_shopling_price_bulk_job(uuid,uuid) from public, anon, authenticated;
revoke all on function public.archive_stale_shopling_price_bulk_jobs(uuid,integer) from public, anon, authenticated;

grant execute on function public.create_shopling_price_bulk_validation_job(uuid,integer) to service_role;
grant execute on function public.archive_shopling_price_bulk_job(uuid,uuid,text) to service_role;
grant execute on function public.restore_shopling_price_bulk_job(uuid,uuid) to service_role;
grant execute on function public.archive_stale_shopling_price_bulk_jobs(uuid,integer) to service_role;
