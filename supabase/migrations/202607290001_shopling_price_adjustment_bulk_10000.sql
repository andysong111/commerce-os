-- Shopling price adjustment bulk engine: up to 10,000 goods_key rows.
-- This is isolated from the existing shopling_price_bulk_* price-policy engine.

create extension if not exists pgcrypto;

create table if not exists public.shopling_price_adjustment_bulk_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  status text not null default 'prepared' check (status in (
    'prepared','running','paused','succeeded','failed','dispatch_uncertain','cancelled'
  )),
  input_source text not null check (input_source in ('paste','csv','xlsx')),
  original_count integer not null check (original_count >= 0),
  valid_count integer not null check (valid_count between 1 and 10000),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  invalid_count integer not null default 0 check (invalid_count >= 0),
  canary_size integer not null check (canary_size between 1 and 10),
  chunk_size integer not null default 50 check (chunk_size = 50),
  total_chunk_count integer not null check (total_chunk_count >= 1),
  pause_requested boolean not null default false,
  worker_id text,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.shopling_price_adjustment_bulk_items (
  job_id uuid not null references public.shopling_price_adjustment_bulk_jobs(id) on delete cascade,
  goods_key text not null,
  ordinal integer not null check (ordinal >= 1),
  adjustment_bps integer not null check (adjustment_bps between -9999 and 100000),
  status text not null default 'pending' check (status in ('pending','running','succeeded','failed','not_executed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (job_id, goods_key),
  unique (job_id, ordinal)
);

create table if not exists public.shopling_price_adjustment_bulk_chunks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.shopling_price_adjustment_bulk_jobs(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  chunk_type text not null check (chunk_type in ('canary','normal')),
  input_rows jsonb not null,
  execution_rows jsonb,
  goods_key_count integer not null check (goods_key_count between 1 and 50),
  status text not null default 'pending' check (status in (
    'pending','planning','ready','executing','succeeded','failed','dispatch_uncertain'
  )),
  plan_request_id text,
  execute_request_id text,
  plan_actions_url text,
  execute_actions_url text,
  plan_run_url text,
  execute_run_url text,
  plan_summary jsonb,
  execute_summary jsonb,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, chunk_index)
);

create index if not exists shopling_price_adjustment_bulk_jobs_owner_created
  on public.shopling_price_adjustment_bulk_jobs(owner_id, created_at desc);
create index if not exists shopling_price_adjustment_bulk_chunks_job_status
  on public.shopling_price_adjustment_bulk_chunks(job_id, status, chunk_index);
create index if not exists shopling_price_adjustment_bulk_items_job_status
  on public.shopling_price_adjustment_bulk_items(job_id, status, ordinal);

alter table public.shopling_price_adjustment_bulk_jobs enable row level security;
alter table public.shopling_price_adjustment_bulk_items enable row level security;
alter table public.shopling_price_adjustment_bulk_chunks enable row level security;
revoke all on public.shopling_price_adjustment_bulk_jobs, public.shopling_price_adjustment_bulk_items, public.shopling_price_adjustment_bulk_chunks from anon, authenticated;

create or replace function public.create_shopling_price_adjustment_bulk_job(
  p_owner_id uuid,
  p_input_source text,
  p_rows jsonb,
  p_original_count integer,
  p_duplicate_count integer,
  p_invalid_count integer
) returns public.shopling_price_adjustment_bulk_jobs
language plpgsql security definer set search_path = public as $$
declare
  v_job public.shopling_price_adjustment_bulk_jobs;
  v_count integer;
  v_canary integer;
  v_chunks integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  if p_input_source not in ('paste','csv','xlsx') then raise exception 'invalid input source'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be array'; end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 10000 then raise exception 'row count must be 1..10000'; end if;
  if p_original_count <> v_count + p_duplicate_count + p_invalid_count then raise exception 'invalid statistics'; end if;
  if p_original_count < 0 or p_duplicate_count < 0 or p_invalid_count < 0 then raise exception 'invalid statistics'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) elem
    where jsonb_typeof(elem) <> 'object'
       or jsonb_object_length(elem) <> 2
       or not (elem ? 'goods_key')
       or not (elem ? 'adjustment_bps')
       or coalesce(elem->>'goods_key','') !~ '^\d+$'
       or coalesce(elem->>'adjustment_bps','') !~ '^-?\d+$'
       or (elem->>'adjustment_bps')::integer not between -9999 and 100000
  ) then raise exception 'invalid adjustment row'; end if;

  if (
    select count(distinct elem->>'goods_key')
    from jsonb_array_elements(p_rows) elem
  ) <> v_count then raise exception 'duplicate goods_key'; end if;

  v_canary := least(v_count, 10);
  v_chunks := 1 + ceil(greatest(v_count - 10, 0) / 50.0)::integer;

  insert into public.shopling_price_adjustment_bulk_jobs(
    owner_id,status,input_source,original_count,valid_count,duplicate_count,invalid_count,
    canary_size,chunk_size,total_chunk_count
  ) values (
    p_owner_id,'prepared',p_input_source,p_original_count,v_count,p_duplicate_count,p_invalid_count,
    v_canary,50,v_chunks
  ) returning * into v_job;

  insert into public.shopling_price_adjustment_bulk_items(job_id,goods_key,ordinal,adjustment_bps,status)
  select v_job.id, elem->>'goods_key', ordinal::integer, (elem->>'adjustment_bps')::integer, 'pending'
  from jsonb_array_elements(p_rows) with ordinality value(elem, ordinal);

  insert into public.shopling_price_adjustment_bulk_chunks(
    job_id,chunk_index,chunk_type,input_rows,goods_key_count,status
  )
  select
    v_job.id,
    chunk_index,
    case when chunk_index = 0 then 'canary' else 'normal' end,
    jsonb_agg(jsonb_build_object('goods_key',goods_key,'adjustment_bps',adjustment_bps) order by ordinal),
    count(*)::integer,
    'pending'
  from (
    select
      elem->>'goods_key' as goods_key,
      (elem->>'adjustment_bps')::integer as adjustment_bps,
      ordinal,
      case when ordinal <= 10 then 0 else 1 + ((ordinal - 11) / 50)::integer end as chunk_index
    from jsonb_array_elements(p_rows) with ordinality value(elem, ordinal)
  ) seeded
  group by chunk_index
  order by chunk_index;

  return v_job;
end $$;

create or replace function public.start_shopling_price_adjustment_bulk_job(
  p_job_id uuid,
  p_owner_id uuid
) returns public.shopling_price_adjustment_bulk_jobs
language plpgsql security definer set search_path = public as $$
declare v_job public.shopling_price_adjustment_bulk_jobs;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  update public.shopling_price_adjustment_bulk_jobs
  set status = 'running', pause_requested = false, last_error = null, updated_at = now()
  where id = p_job_id and owner_id = p_owner_id and status in ('prepared','paused')
  returning * into v_job;
  if v_job.id is null then raise exception 'job cannot start'; end if;
  return v_job;
end $$;

create or replace function public.request_pause_shopling_price_adjustment_bulk_job(
  p_job_id uuid,
  p_owner_id uuid
) returns public.shopling_price_adjustment_bulk_jobs
language plpgsql security definer set search_path = public as $$
declare v_job public.shopling_price_adjustment_bulk_jobs;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  update public.shopling_price_adjustment_bulk_jobs
  set pause_requested = true, updated_at = now()
  where id = p_job_id and owner_id = p_owner_id and status = 'running'
  returning * into v_job;
  if v_job.id is null then raise exception 'job cannot pause'; end if;
  return v_job;
end $$;

create or replace function public.claim_shopling_price_adjustment_bulk_job(
  p_job_id uuid,
  p_owner_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 90
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_job public.shopling_price_adjustment_bulk_jobs;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  if p_worker_id is null or length(p_worker_id) < 8 or length(p_worker_id) > 120 then raise exception 'invalid worker id'; end if;
  if p_lease_seconds not between 30 and 300 then raise exception 'invalid lease'; end if;

  select * into v_job from public.shopling_price_adjustment_bulk_jobs
  where id = p_job_id and owner_id = p_owner_id for update;
  if v_job.id is null then raise exception 'job not found'; end if;

  if v_job.status = 'running' and v_job.pause_requested then
    update public.shopling_price_adjustment_bulk_jobs
    set status = 'paused', pause_requested = false, worker_id = null, lease_until = null, updated_at = now()
    where id = p_job_id;
    return jsonb_build_object('claimed',false,'status','paused');
  end if;
  if v_job.status <> 'running' then
    return jsonb_build_object('claimed',false,'status',v_job.status);
  end if;
  if v_job.lease_until is not null and v_job.lease_until > now() and v_job.worker_id is distinct from p_worker_id then
    return jsonb_build_object('claimed',false,'status',v_job.status,'leased',true);
  end if;

  update public.shopling_price_adjustment_bulk_jobs
  set worker_id = p_worker_id, lease_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
  where id = p_job_id;
  return jsonb_build_object('claimed',true,'status','running','job_id',p_job_id,'owner_id',p_owner_id);
end $$;

create or replace function public.release_shopling_price_adjustment_bulk_job(
  p_job_id uuid,
  p_owner_id uuid,
  p_worker_id text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  update public.shopling_price_adjustment_bulk_jobs
  set worker_id = null, lease_until = null, updated_at = now()
  where id = p_job_id and owner_id = p_owner_id and worker_id = p_worker_id;
end $$;

create or replace function public.mark_shopling_price_adjustment_plan_dispatched(
  p_job_id uuid,
  p_owner_id uuid,
  p_chunk_id uuid,
  p_request_id text,
  p_actions_url text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  update public.shopling_price_adjustment_bulk_chunks chunk
  set status = 'planning', plan_request_id = p_request_id, plan_actions_url = p_actions_url,
      started_at = coalesce(started_at,now()), updated_at = now(), last_error = null
  from public.shopling_price_adjustment_bulk_jobs job
  where chunk.id = p_chunk_id and chunk.job_id = job.id and job.id = p_job_id and job.owner_id = p_owner_id
    and job.status = 'running' and chunk.status = 'pending';
  if not found then raise exception 'invalid plan dispatch transition'; end if;
end $$;

create or replace function public.mark_shopling_price_adjustment_plan_ready(
  p_job_id uuid,
  p_owner_id uuid,
  p_chunk_id uuid,
  p_execution_rows jsonb,
  p_summary jsonb,
  p_run_url text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  if jsonb_typeof(p_execution_rows) <> 'array' then raise exception 'execution rows must be array'; end if;
  update public.shopling_price_adjustment_bulk_chunks chunk
  set status = 'ready', execution_rows = p_execution_rows, plan_summary = p_summary,
      plan_run_url = p_run_url, updated_at = now(), last_error = null
  from public.shopling_price_adjustment_bulk_jobs job
  where chunk.id = p_chunk_id and chunk.job_id = job.id and job.id = p_job_id and job.owner_id = p_owner_id
    and job.status = 'running' and chunk.status = 'planning';
  if not found then raise exception 'invalid plan ready transition'; end if;
end $$;

create or replace function public.mark_shopling_price_adjustment_execution_dispatched(
  p_job_id uuid,
  p_owner_id uuid,
  p_chunk_id uuid,
  p_request_id text,
  p_actions_url text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  update public.shopling_price_adjustment_bulk_chunks chunk
  set status = 'executing', execute_request_id = p_request_id, execute_actions_url = p_actions_url,
      updated_at = now(), last_error = null
  from public.shopling_price_adjustment_bulk_jobs job
  where chunk.id = p_chunk_id and chunk.job_id = job.id and job.id = p_job_id and job.owner_id = p_owner_id
    and job.status = 'running' and chunk.status = 'ready';
  if not found then raise exception 'invalid execution dispatch transition'; end if;

  update public.shopling_price_adjustment_bulk_items item
  set status = 'running', attempt_count = attempt_count + 1, updated_at = now()
  where item.job_id = p_job_id
    and item.goods_key in (
      select elem->>'goods_key'
      from public.shopling_price_adjustment_bulk_chunks c,
           jsonb_array_elements(c.input_rows) elem
      where c.id = p_chunk_id
    );
end $$;

create or replace function public.finish_shopling_price_adjustment_execution(
  p_job_id uuid,
  p_owner_id uuid,
  p_chunk_id uuid,
  p_summary jsonb,
  p_run_url text,
  p_success boolean,
  p_error text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_remaining integer; v_status text;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  update public.shopling_price_adjustment_bulk_chunks chunk
  set status = case when p_success then 'succeeded' else 'failed' end,
      execute_summary = p_summary, execute_run_url = p_run_url,
      last_error = case when p_success then null else left(coalesce(p_error,'execution failed'),2000) end,
      completed_at = now(), updated_at = now()
  from public.shopling_price_adjustment_bulk_jobs job
  where chunk.id = p_chunk_id and chunk.job_id = job.id and job.id = p_job_id and job.owner_id = p_owner_id
    and job.status = 'running' and chunk.status = 'executing';
  if not found then raise exception 'invalid execution finish transition'; end if;

  update public.shopling_price_adjustment_bulk_items item
  set status = case
        when result_row->>'status' = 'success' then 'succeeded'
        when result_row->>'status' = 'not_executed' then 'not_executed'
        else 'failed'
      end,
      result = result_row,
      updated_at = now()
  from jsonb_array_elements(coalesce(p_summary->'rows','[]'::jsonb)) result_row
  where item.job_id = p_job_id and item.goods_key = result_row->>'goods_key';

  if not p_success then
    update public.shopling_price_adjustment_bulk_items
    set status = 'not_executed', updated_at = now()
    where job_id = p_job_id and status = 'pending';
    update public.shopling_price_adjustment_bulk_jobs
    set status = 'failed', last_error = left(coalesce(p_error,'execution failed'),2000),
        worker_id = null, lease_until = null, updated_at = now()
    where id = p_job_id and owner_id = p_owner_id;
    return jsonb_build_object('status','failed','completed',true);
  end if;

  select count(*) into v_remaining
  from public.shopling_price_adjustment_bulk_chunks
  where job_id = p_job_id and status <> 'succeeded';

  if v_remaining = 0 then
    v_status := 'succeeded';
    update public.shopling_price_adjustment_bulk_jobs
    set status = 'succeeded', completed_at = now(), last_error = null,
        worker_id = null, lease_until = null, updated_at = now()
    where id = p_job_id and owner_id = p_owner_id;
  else
    v_status := 'running';
  end if;
  return jsonb_build_object('status',v_status,'completed',v_remaining = 0);
end $$;

create or replace function public.block_shopling_price_adjustment_dispatch_uncertain(
  p_job_id uuid,
  p_owner_id uuid,
  p_chunk_id uuid,
  p_error text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  update public.shopling_price_adjustment_bulk_chunks
  set status = 'dispatch_uncertain', last_error = left(coalesce(p_error,'dispatch uncertain'),2000), updated_at = now()
  where id = p_chunk_id and job_id = p_job_id and status in ('pending','planning','ready','executing');
  update public.shopling_price_adjustment_bulk_jobs
  set status = 'dispatch_uncertain', last_error = left(coalesce(p_error,'dispatch uncertain'),2000),
      worker_id = null, lease_until = null, updated_at = now()
  where id = p_job_id and owner_id = p_owner_id;
end $$;

revoke all on function public.create_shopling_price_adjustment_bulk_job(uuid,text,jsonb,integer,integer,integer) from public, anon, authenticated;
revoke all on function public.start_shopling_price_adjustment_bulk_job(uuid,uuid) from public, anon, authenticated;
revoke all on function public.request_pause_shopling_price_adjustment_bulk_job(uuid,uuid) from public, anon, authenticated;
revoke all on function public.claim_shopling_price_adjustment_bulk_job(uuid,uuid,text,integer) from public, anon, authenticated;
revoke all on function public.release_shopling_price_adjustment_bulk_job(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.mark_shopling_price_adjustment_plan_dispatched(uuid,uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.mark_shopling_price_adjustment_plan_ready(uuid,uuid,uuid,jsonb,jsonb,text) from public, anon, authenticated;
revoke all on function public.mark_shopling_price_adjustment_execution_dispatched(uuid,uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.finish_shopling_price_adjustment_execution(uuid,uuid,uuid,jsonb,text,boolean,text) from public, anon, authenticated;
revoke all on function public.block_shopling_price_adjustment_dispatch_uncertain(uuid,uuid,uuid,text) from public, anon, authenticated;

grant execute on function public.create_shopling_price_adjustment_bulk_job(uuid,text,jsonb,integer,integer,integer) to service_role;
grant execute on function public.start_shopling_price_adjustment_bulk_job(uuid,uuid) to service_role;
grant execute on function public.request_pause_shopling_price_adjustment_bulk_job(uuid,uuid) to service_role;
grant execute on function public.claim_shopling_price_adjustment_bulk_job(uuid,uuid,text,integer) to service_role;
grant execute on function public.release_shopling_price_adjustment_bulk_job(uuid,uuid,text) to service_role;
grant execute on function public.mark_shopling_price_adjustment_plan_dispatched(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.mark_shopling_price_adjustment_plan_ready(uuid,uuid,uuid,jsonb,jsonb,text) to service_role;
grant execute on function public.mark_shopling_price_adjustment_execution_dispatched(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.finish_shopling_price_adjustment_execution(uuid,uuid,uuid,jsonb,text,boolean,text) to service_role;
grant execute on function public.block_shopling_price_adjustment_dispatch_uncertain(uuid,uuid,uuid,text) to service_role;
