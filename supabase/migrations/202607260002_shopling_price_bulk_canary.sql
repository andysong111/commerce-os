alter table public.shopling_price_bulk_jobs
  drop constraint if exists shopling_price_bulk_jobs_status_check;
alter table public.shopling_price_bulk_jobs
  add constraint shopling_price_bulk_jobs_status_check
  check (status in (
    'prepared',
    'canary_dispatching',
    'canary_running',
    'canary_succeeded',
    'canary_failed',
    'dispatch_uncertain',
    'cancelled'
  ));

alter table public.shopling_price_bulk_items
  drop constraint if exists shopling_price_bulk_items_status_check;
alter table public.shopling_price_bulk_items
  add constraint shopling_price_bulk_items_status_check
  check (status in ('pending', 'succeeded', 'failed'));

alter table public.shopling_price_bulk_chunks
  drop constraint if exists shopling_price_bulk_chunks_status_check;
alter table public.shopling_price_bulk_chunks
  add constraint shopling_price_bulk_chunks_status_check
  check (status in ('pending', 'dispatching', 'running', 'succeeded', 'failed', 'dispatch_uncertain'));

alter table public.shopling_price_bulk_jobs
  add column if not exists last_error text;

alter table public.shopling_price_bulk_items
  add column if not exists last_error text;

alter table public.shopling_price_bulk_chunks
  add column if not exists request_id text,
  add column if not exists actions_url text,
  add column if not exists result_summary jsonb,
  add column if not exists last_error text,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz;

create unique index if not exists shopling_price_bulk_chunks_request_id_unique
  on public.shopling_price_bulk_chunks(request_id)
  where request_id is not null;

create or replace function public.reserve_shopling_price_bulk_canary(
  p_job_id uuid,
  p_owner_id uuid,
  p_request_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.shopling_price_bulk_jobs;
  v_chunk public.shopling_price_bulk_chunks;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9._:-]{1,120}$' then
    raise exception 'invalid request id';
  end if;

  select * into v_job
  from public.shopling_price_bulk_jobs
  where id = p_job_id and owner_id = p_owner_id
  for update;

  if v_job.id is null then raise exception 'job not found'; end if;
  if v_job.status <> 'prepared' then raise exception 'job is not prepared'; end if;

  select * into v_chunk
  from public.shopling_price_bulk_chunks
  where job_id = p_job_id and chunk_index = 0 and chunk_type = 'canary'
  for update;

  if v_chunk.id is null then raise exception 'canary chunk not found'; end if;
  if v_chunk.status <> 'pending' or v_chunk.request_id is not null then
    raise exception 'canary already reserved';
  end if;

  update public.shopling_price_bulk_chunks
  set status = 'dispatching', request_id = p_request_id, started_at = now(), updated_at = now(), last_error = null
  where id = v_chunk.id;

  update public.shopling_price_bulk_jobs
  set status = 'canary_dispatching', updated_at = now(), last_error = null
  where id = p_job_id;

  return jsonb_build_object(
    'job_id', p_job_id,
    'chunk_id', v_chunk.id,
    'goods_keys', v_chunk.goods_keys,
    'goods_key_count', v_chunk.goods_key_count,
    'request_id', p_request_id,
    'policy_overrides', v_job.policy_overrides
  );
end;
$$;

create or replace function public.mark_shopling_price_bulk_canary_running(
  p_job_id uuid,
  p_owner_id uuid,
  p_request_id text,
  p_actions_url text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chunk_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  update public.shopling_price_bulk_chunks c
  set status = 'running', actions_url = p_actions_url, updated_at = now()
  from public.shopling_price_bulk_jobs j
  where c.job_id = j.id
    and j.id = p_job_id
    and j.owner_id = p_owner_id
    and c.chunk_index = 0
    and c.chunk_type = 'canary'
    and c.status = 'dispatching'
    and c.request_id = p_request_id
  returning c.id into v_chunk_id;

  if v_chunk_id is null then raise exception 'invalid canary running transition'; end if;

  update public.shopling_price_bulk_jobs
  set status = 'canary_running', updated_at = now(), last_error = null
  where id = p_job_id and owner_id = p_owner_id and status = 'canary_dispatching';

  return jsonb_build_object('job_id', p_job_id, 'chunk_id', v_chunk_id, 'status', 'canary_running');
end;
$$;

create or replace function public.reset_shopling_price_bulk_canary_rejected(
  p_job_id uuid,
  p_owner_id uuid,
  p_request_id text,
  p_error text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  update public.shopling_price_bulk_chunks c
  set status = 'pending', request_id = null, actions_url = null, started_at = null, updated_at = now(), last_error = left(coalesce(p_error, 'dispatch rejected'), 1000)
  from public.shopling_price_bulk_jobs j
  where c.job_id = j.id
    and j.id = p_job_id
    and j.owner_id = p_owner_id
    and c.chunk_index = 0
    and c.chunk_type = 'canary'
    and c.status = 'dispatching'
    and c.request_id = p_request_id;

  update public.shopling_price_bulk_jobs
  set status = 'prepared', updated_at = now(), last_error = left(coalesce(p_error, 'dispatch rejected'), 1000)
  where id = p_job_id and owner_id = p_owner_id and status = 'canary_dispatching';
end;
$$;

create or replace function public.block_shopling_price_bulk_canary_uncertain(
  p_job_id uuid,
  p_owner_id uuid,
  p_request_id text,
  p_error text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  update public.shopling_price_bulk_chunks c
  set status = 'dispatch_uncertain', updated_at = now(), last_error = left(coalesce(p_error, 'dispatch result uncertain'), 1000)
  from public.shopling_price_bulk_jobs j
  where c.job_id = j.id
    and j.id = p_job_id
    and j.owner_id = p_owner_id
    and c.chunk_index = 0
    and c.chunk_type = 'canary'
    and c.request_id = p_request_id
    and c.status in ('dispatching', 'running');

  update public.shopling_price_bulk_jobs
  set status = 'dispatch_uncertain', updated_at = now(), last_error = left(coalesce(p_error, 'dispatch result uncertain'), 1000)
  where id = p_job_id and owner_id = p_owner_id and status in ('canary_dispatching', 'canary_running');
end;
$$;

create or replace function public.finish_shopling_price_bulk_canary(
  p_job_id uuid,
  p_owner_id uuid,
  p_request_id text,
  p_success boolean,
  p_failure_scope_known boolean,
  p_failed_keys text[],
  p_summary jsonb,
  p_run_url text,
  p_error text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chunk public.shopling_price_bulk_chunks;
  v_failed_keys text[] := coalesce(p_failed_keys, array[]::text[]);
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  select c.* into v_chunk
  from public.shopling_price_bulk_chunks c
  join public.shopling_price_bulk_jobs j on j.id = c.job_id
  where c.job_id = p_job_id
    and j.owner_id = p_owner_id
    and c.chunk_index = 0
    and c.chunk_type = 'canary'
    and c.request_id = p_request_id
    and c.status in ('running', 'dispatch_uncertain')
  for update of c;

  if v_chunk.id is null then raise exception 'canary result transition not allowed'; end if;

  if exists (
    select 1
    from unnest(v_failed_keys) failed_key
    where not exists (
      select 1 from jsonb_array_elements_text(v_chunk.goods_keys) chunk_key where chunk_key = failed_key
    )
  ) then
    raise exception 'failed key is outside canary chunk';
  end if;

  if p_success and cardinality(v_failed_keys) > 0 then
    raise exception 'successful canary cannot include failed keys';
  end if;

  if p_success then
    update public.shopling_price_bulk_items
    set status = 'succeeded', last_error = null, updated_at = now()
    where job_id = p_job_id and goods_key in (select jsonb_array_elements_text(v_chunk.goods_keys));
  elsif p_failure_scope_known then
    update public.shopling_price_bulk_items
    set status = case when goods_key = any(v_failed_keys) then 'failed' else 'succeeded' end,
        last_error = case when goods_key = any(v_failed_keys) then left(coalesce(p_error, 'canary failed'), 1000) else null end,
        updated_at = now()
    where job_id = p_job_id and goods_key in (select jsonb_array_elements_text(v_chunk.goods_keys));
  else
    update public.shopling_price_bulk_items
    set status = 'pending', last_error = left(coalesce(p_error, 'canary failure scope unknown'), 1000), updated_at = now()
    where job_id = p_job_id and goods_key in (select jsonb_array_elements_text(v_chunk.goods_keys));
  end if;

  update public.shopling_price_bulk_chunks
  set status = case when p_success then 'succeeded' else 'failed' end,
      result_summary = p_summary,
      actions_url = coalesce(p_run_url, actions_url),
      completed_at = now(),
      updated_at = now(),
      last_error = case when p_success then null else left(coalesce(p_error, 'canary failed'), 1000) end
  where id = v_chunk.id;

  update public.shopling_price_bulk_jobs
  set status = case when p_success then 'canary_succeeded' else 'canary_failed' end,
      updated_at = now(),
      last_error = case when p_success then null else left(coalesce(p_error, 'canary failed'), 1000) end
  where id = p_job_id and owner_id = p_owner_id;

  return jsonb_build_object(
    'job_id', p_job_id,
    'chunk_id', v_chunk.id,
    'status', case when p_success then 'canary_succeeded' else 'canary_failed' end,
    'failed_keys', to_jsonb(v_failed_keys),
    'failure_scope_known', p_failure_scope_known
  );
end;
$$;

revoke all on function public.reserve_shopling_price_bulk_canary(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.mark_shopling_price_bulk_canary_running(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.reset_shopling_price_bulk_canary_rejected(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.block_shopling_price_bulk_canary_uncertain(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.finish_shopling_price_bulk_canary(uuid,uuid,text,boolean,boolean,text[],jsonb,text,text) from public, anon, authenticated;

grant execute on function public.reserve_shopling_price_bulk_canary(uuid,uuid,text) to service_role;
grant execute on function public.mark_shopling_price_bulk_canary_running(uuid,uuid,text,text) to service_role;
grant execute on function public.reset_shopling_price_bulk_canary_rejected(uuid,uuid,text,text) to service_role;
grant execute on function public.block_shopling_price_bulk_canary_uncertain(uuid,uuid,text,text) to service_role;
grant execute on function public.finish_shopling_price_bulk_canary(uuid,uuid,text,boolean,boolean,text[],jsonb,text,text) to service_role;
