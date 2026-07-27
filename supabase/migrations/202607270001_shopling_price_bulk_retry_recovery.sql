-- Stage 5: bounded failed-item retry and pause/recovery.
-- Apply manually only after PR review and Preview verification.

alter table public.shopling_price_bulk_jobs
  drop constraint if exists shopling_price_bulk_jobs_status_check;
alter table public.shopling_price_bulk_jobs
  add constraint shopling_price_bulk_jobs_status_check
  check (status in (
    'prepared','canary_dispatching','canary_running','canary_succeeded','canary_failed',
    'normal_running','normal_paused','normal_succeeded','normal_failed',
    'retry_running','retry_paused','retry_failed','dispatch_uncertain','cancelled'
  ));

alter table public.shopling_price_bulk_jobs
  add column if not exists pause_requested boolean not null default false,
  add column if not exists retry_round integer not null default 0,
  add column if not exists max_retry_rounds integer not null default 2,
  add column if not exists retry_resume_status text,
  add column if not exists retry_scope_known boolean not null default true;

alter table public.shopling_price_bulk_jobs
  drop constraint if exists shopling_price_bulk_jobs_retry_resume_status_check;
alter table public.shopling_price_bulk_jobs
  add constraint shopling_price_bulk_jobs_retry_resume_status_check
  check (retry_resume_status is null or retry_resume_status in ('canary_succeeded','normal_running'));

alter table public.shopling_price_bulk_jobs
  drop constraint if exists shopling_price_bulk_jobs_retry_round_check;
alter table public.shopling_price_bulk_jobs
  add constraint shopling_price_bulk_jobs_retry_round_check
  check (retry_round between 0 and max_retry_rounds and max_retry_rounds = 2);

alter table public.shopling_price_bulk_chunks
  drop constraint if exists shopling_price_bulk_chunks_chunk_type_check;
alter table public.shopling_price_bulk_chunks
  add constraint shopling_price_bulk_chunks_chunk_type_check
  check (chunk_type in ('canary','normal','retry'));

alter table public.shopling_price_bulk_chunks
  drop constraint if exists shopling_price_bulk_chunks_status_check;
alter table public.shopling_price_bulk_chunks
  add constraint shopling_price_bulk_chunks_status_check
  check (status in ('pending','dispatching','running','succeeded','failed','recovered','superseded','dispatch_uncertain'));

alter table public.shopling_price_bulk_chunks
  add column if not exists retry_round integer not null default 0;

create index if not exists shopling_price_bulk_chunks_retry_lookup
  on public.shopling_price_bulk_chunks(job_id,chunk_type,retry_round,status);
create index if not exists shopling_price_bulk_chunks_job_status
  on public.shopling_price_bulk_chunks(job_id,status);

create or replace function public.approve_shopling_price_bulk_failed_retry(
  p_job_id uuid,
  p_owner_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.shopling_price_bulk_jobs;
  v_failed integer;
  v_chunks integer;
  v_base integer;
  v_round integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  select * into v_job
  from public.shopling_price_bulk_jobs
  where id = p_job_id and owner_id = p_owner_id
  for update;

  if v_job.id is null then raise exception 'job not found'; end if;
  if v_job.status not in ('canary_failed','normal_failed','retry_failed') then
    raise exception 'retry approval not allowed';
  end if;
  if not v_job.retry_scope_known then raise exception 'retry failure scope is unknown'; end if;
  if v_job.retry_round >= v_job.max_retry_rounds then raise exception 'maximum retry rounds reached'; end if;
  if exists (
    select 1 from public.shopling_price_bulk_chunks
    where job_id = p_job_id and status in ('dispatching','running','dispatch_uncertain')
  ) then raise exception 'active chunk exists'; end if;

  update public.shopling_price_bulk_chunks
  set status = 'superseded',
      updated_at = now(),
      last_error = coalesce(last_error,'superseded by a later retry round')
  where job_id = p_job_id
    and chunk_type = 'retry'
    and retry_round = v_job.retry_round
    and status = 'pending';

  select count(*) into v_failed
  from public.shopling_price_bulk_items
  where job_id = p_job_id and status = 'failed';
  if v_failed = 0 then raise exception 'failed item scope is unknown'; end if;

  v_round := v_job.retry_round + 1;
  select coalesce(max(chunk_index),-1) + 1 into v_base
  from public.shopling_price_bulk_chunks
  where job_id = p_job_id;

  insert into public.shopling_price_bulk_chunks(
    job_id,chunk_index,chunk_type,goods_keys,goods_key_count,status,attempt_count,retry_round
  )
  select
    p_job_id,
    v_base + bucket,
    'retry',
    to_jsonb(array_agg(goods_key order by ordinal)),
    count(*)::integer,
    'pending',
    0,
    v_round
  from (
    select goods_key,ordinal,((row_number() over(order by ordinal)-1)/50)::integer as bucket
    from public.shopling_price_bulk_items
    where job_id = p_job_id and status = 'failed'
  ) failed_only
  group by bucket
  order by bucket;

  get diagnostics v_chunks = row_count;

  update public.shopling_price_bulk_jobs
  set retry_round = v_round,
      status = 'retry_running',
      pause_requested = false,
      retry_scope_known = true,
      retry_resume_status = case
        when v_job.status = 'canary_failed' then 'canary_succeeded'
        when v_job.status = 'normal_failed' then 'normal_running'
        else v_job.retry_resume_status
      end,
      last_error = null,
      updated_at = now()
  where id = p_job_id and owner_id = p_owner_id;

  return jsonb_build_object(
    'retry_round',v_round,
    'failed_goods_key_count',v_failed,
    'retry_chunk_count',v_chunks,
    'status','retry_running'
  );
end;
$$;

create or replace function public.reserve_next_shopling_price_bulk_retry_chunk(
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
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9._:-]{1,120}$' then
    raise exception 'invalid request id';
  end if;

  select * into v_job
  from public.shopling_price_bulk_jobs
  where id = p_job_id and owner_id = p_owner_id
  for update;

  if v_job.id is null then raise exception 'job not found'; end if;
  if v_job.status = 'retry_paused' then
    return jsonb_build_object('paused',true,'status','retry_paused');
  end if;
  if v_job.status <> 'retry_running' then raise exception 'retry execution is not running'; end if;
  if v_job.pause_requested then
    update public.shopling_price_bulk_jobs
    set status = 'retry_paused',updated_at = now()
    where id = p_job_id and owner_id = p_owner_id;
    return jsonb_build_object('paused',true,'status','retry_paused');
  end if;
  if exists (
    select 1 from public.shopling_price_bulk_chunks
    where job_id = p_job_id and status in ('dispatching','running','dispatch_uncertain')
  ) then raise exception 'active chunk exists'; end if;

  select * into v_chunk
  from public.shopling_price_bulk_chunks
  where job_id = p_job_id
    and chunk_type = 'retry'
    and retry_round = v_job.retry_round
    and status = 'pending'
    and attempt_count = 0
  order by chunk_index asc
  limit 1
  for update skip locked;

  if v_chunk.id is null then raise exception 'no reservable retry chunk'; end if;
  if exists (
    select 1
    from jsonb_array_elements_text(v_chunk.goods_keys) as retry_key(value)
    where not exists (
      select 1 from public.shopling_price_bulk_items item
      where item.job_id = p_job_id
        and item.goods_key = retry_key.value
        and item.status = 'failed'
    )
  ) then raise exception 'retry chunk contains non-failed item'; end if;

  update public.shopling_price_bulk_chunks
  set status = 'dispatching',
      request_id = p_request_id,
      attempt_count = attempt_count + 1,
      started_at = now(),
      updated_at = now(),
      last_error = null
  where id = v_chunk.id;

  update public.shopling_price_bulk_items
  set attempt_count = attempt_count + 1,updated_at = now()
  where job_id = p_job_id
    and status = 'failed'
    and goods_key in (select jsonb_array_elements_text(v_chunk.goods_keys));

  return jsonb_build_object(
    'completed',false,
    'chunk_id',v_chunk.id,
    'chunk_index',v_chunk.chunk_index,
    'goods_keys',v_chunk.goods_keys,
    'goods_key_count',v_chunk.goods_key_count,
    'request_id',p_request_id,
    'policy_overrides',v_job.policy_overrides,
    'retry_round',v_job.retry_round
  );
end;
$$;

create or replace function public.mark_shopling_price_bulk_retry_running(
  p_job_id uuid,
  p_owner_id uuid,
  p_request_id text,
  p_actions_url text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  update public.shopling_price_bulk_chunks chunk
  set status = 'running',actions_url = p_actions_url,updated_at = now()
  from public.shopling_price_bulk_jobs job
  where chunk.job_id = job.id
    and job.id = p_job_id
    and job.owner_id = p_owner_id
    and job.status = 'retry_running'
    and chunk.chunk_type = 'retry'
    and chunk.status = 'dispatching'
    and chunk.request_id = p_request_id
  returning chunk.id into v_id;
  if v_id is null then raise exception 'invalid retry running transition'; end if;
  return jsonb_build_object('chunk_id',v_id,'status','running');
end;
$$;

create or replace function public.fail_shopling_price_bulk_retry_dispatch_rejected(
  p_job_id uuid,
  p_owner_id uuid,
  p_request_id text,
  p_error text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_round integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  update public.shopling_price_bulk_chunks chunk
  set status = 'failed',
      last_error = left(coalesce(p_error,'dispatch rejected'),1000),
      completed_at = now(),
      updated_at = now()
  from public.shopling_price_bulk_jobs job
  where chunk.job_id = job.id
    and job.id = p_job_id
    and job.owner_id = p_owner_id
    and chunk.chunk_type = 'retry'
    and chunk.status = 'dispatching'
    and chunk.request_id = p_request_id
  returning chunk.id,chunk.retry_round into v_id,v_round;
  if v_id is null then raise exception 'invalid retry rejected transition'; end if;

  update public.shopling_price_bulk_chunks
  set status = 'superseded',
      updated_at = now(),
      last_error = coalesce(last_error,'superseded after retry dispatch rejection')
  where job_id = p_job_id
    and chunk_type = 'retry'
    and retry_round = v_round
    and status = 'pending';

  update public.shopling_price_bulk_jobs
  set status = 'retry_failed',
      pause_requested = false,
      retry_scope_known = true,
      last_error = left(coalesce(p_error,'dispatch rejected'),1000),
      updated_at = now()
  where id = p_job_id and owner_id = p_owner_id;
end;
$$;

create or replace function public.block_shopling_price_bulk_retry_uncertain(
  p_job_id uuid,
  p_owner_id uuid,
  p_request_id text,
  p_error text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  update public.shopling_price_bulk_chunks chunk
  set status = 'dispatch_uncertain',
      last_error = left(coalesce(p_error,'dispatch uncertain'),1000),
      updated_at = now()
  from public.shopling_price_bulk_jobs job
  where chunk.job_id = job.id
    and job.id = p_job_id
    and job.owner_id = p_owner_id
    and chunk.chunk_type = 'retry'
    and chunk.request_id = p_request_id
    and chunk.status in ('dispatching','running')
  returning chunk.id into v_id;
  if v_id is null then raise exception 'invalid retry uncertain transition'; end if;

  update public.shopling_price_bulk_jobs
  set status = 'dispatch_uncertain',
      last_error = left(coalesce(p_error,'dispatch uncertain'),1000),
      updated_at = now()
  where id = p_job_id and owner_id = p_owner_id;
end;
$$;

create or replace function public.finish_shopling_price_bulk_retry_chunk(
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
  v_job public.shopling_price_bulk_jobs;
  v_chunk public.shopling_price_bulk_chunks;
  v_failed text[] := coalesce(p_failed_keys,array[]::text[]);
  v_remaining integer := 0;
  v_status text;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  select * into v_job
  from public.shopling_price_bulk_jobs
  where id = p_job_id and owner_id = p_owner_id
  for update;
  if v_job.id is null then raise exception 'job not found for owner'; end if;

  select * into v_chunk
  from public.shopling_price_bulk_chunks
  where job_id = v_job.id
    and chunk_type = 'retry'
    and request_id = p_request_id
    and status in ('dispatching','running','dispatch_uncertain')
  for update;
  if v_chunk.id is null then raise exception 'retry result transition not allowed'; end if;

  if exists (
    select 1
    from unnest(v_failed) as failed_key(value)
    where not exists (
      select 1
      from jsonb_array_elements_text(v_chunk.goods_keys) as chunk_key(value)
      where chunk_key.value = failed_key.value
    )
  ) then raise exception 'failed key outside chunk'; end if;
  if p_success and cardinality(v_failed) > 0 then raise exception 'success cannot include failed keys'; end if;
  if not p_success and p_failure_scope_known and cardinality(v_failed) = 0 then
    raise exception 'known retry failure requires failed keys';
  end if;

  if p_success then
    update public.shopling_price_bulk_items
    set status = 'succeeded',last_error = null,updated_at = now()
    where job_id = v_job.id
      and goods_key in (select jsonb_array_elements_text(v_chunk.goods_keys));
  elsif p_failure_scope_known then
    update public.shopling_price_bulk_items
    set status = case when goods_key = any(v_failed) then 'failed' else 'succeeded' end,
        last_error = case
          when goods_key = any(v_failed) then left(coalesce(p_error,'retry failed'),1000)
          else null
        end,
        updated_at = now()
    where job_id = v_job.id
      and goods_key in (select jsonb_array_elements_text(v_chunk.goods_keys));
  else
    update public.shopling_price_bulk_items
    set status = 'failed',
        last_error = left(coalesce(p_error,'retry failure scope unknown'),1000),
        updated_at = now()
    where job_id = v_job.id
      and goods_key in (select jsonb_array_elements_text(v_chunk.goods_keys));
  end if;

  update public.shopling_price_bulk_chunks
  set status = case when p_success then 'succeeded' else 'failed' end,
      result_summary = p_summary,
      actions_url = coalesce(p_run_url,actions_url),
      completed_at = now(),
      updated_at = now(),
      last_error = case when p_success then null else left(coalesce(p_error,'retry failed'),1000) end
  where id = v_chunk.id;

  if not p_success then
    update public.shopling_price_bulk_chunks
    set status = 'superseded',
        updated_at = now(),
        last_error = coalesce(last_error,'superseded after retry failure')
    where job_id = v_job.id
      and chunk_type = 'retry'
      and retry_round = v_chunk.retry_round
      and status = 'pending';
    v_status := 'retry_failed';
  else
    update public.shopling_price_bulk_chunks original
    set status = 'recovered',updated_at = now()
    where original.job_id = v_job.id
      and original.chunk_type in ('canary','normal')
      and original.status = 'failed'
      and not exists (
        select 1
        from jsonb_array_elements_text(original.goods_keys) as original_key(value)
        join public.shopling_price_bulk_items item
          on item.job_id = v_job.id and item.goods_key = original_key.value
        where item.status <> 'succeeded'
      );

    select count(*) into v_remaining
    from public.shopling_price_bulk_chunks
    where job_id = v_job.id
      and chunk_type = 'retry'
      and retry_round = v_job.retry_round
      and status = 'pending';

    if v_remaining > 0 then
      v_status := case when v_job.pause_requested then 'retry_paused' else 'retry_running' end;
    elsif v_job.retry_resume_status = 'canary_succeeded' then
      if not exists (
        select 1 from public.shopling_price_bulk_chunks
        where job_id = v_job.id
          and chunk_type = 'canary'
          and status in ('succeeded','recovered')
      ) then raise exception 'canary was not recovered'; end if;
      v_status := 'canary_succeeded';
    elsif exists (
      select 1 from public.shopling_price_bulk_chunks
      where job_id = v_job.id and chunk_type = 'normal' and status = 'pending'
    ) then
      v_status := case when v_job.pause_requested then 'normal_paused' else 'normal_running' end;
    else
      v_status := 'normal_succeeded';
    end if;
  end if;

  update public.shopling_price_bulk_jobs
  set status = v_status,
      pause_requested = (v_status in ('normal_paused','retry_paused')),
      retry_scope_known = case when p_success then true else p_failure_scope_known end,
      last_error = case when p_success then null else left(coalesce(p_error,'retry failed'),1000) end,
      updated_at = now()
  where id = v_job.id and owner_id = p_owner_id;

  return jsonb_build_object(
    'status',v_status,
    'remaining_chunk_count',v_remaining,
    'chunk_index',v_chunk.chunk_index,
    'retry_scope_known',case when p_success then true else p_failure_scope_known end
  );
end;
$$;

create or replace function public.request_shopling_price_bulk_pause(
  p_job_id uuid,
  p_owner_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.shopling_price_bulk_jobs;
  v_active boolean;
  v_status text;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  select * into v_job
  from public.shopling_price_bulk_jobs
  where id = p_job_id and owner_id = p_owner_id
  for update;
  if v_job.id is null then raise exception 'job not found'; end if;
  if v_job.status not in ('normal_running','retry_running') then raise exception 'pause not allowed'; end if;

  select exists (
    select 1 from public.shopling_price_bulk_chunks
    where job_id = p_job_id and status in ('dispatching','running','dispatch_uncertain')
  ) into v_active;

  v_status := case
    when v_active then v_job.status
    when v_job.status = 'normal_running' then 'normal_paused'
    else 'retry_paused'
  end;

  update public.shopling_price_bulk_jobs
  set pause_requested = true,status = v_status,updated_at = now()
  where id = p_job_id and owner_id = p_owner_id;

  return jsonb_build_object('status',v_status,'pause_after_current',v_active);
end;
$$;

create or replace function public.resume_shopling_price_bulk_execution(
  p_job_id uuid,
  p_owner_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_status text;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  select case status
    when 'normal_paused' then 'normal_running'
    when 'retry_paused' then 'retry_running'
  end into v_status
  from public.shopling_price_bulk_jobs
  where id = p_job_id and owner_id = p_owner_id
  for update;
  if v_status is null then raise exception 'resume not allowed'; end if;

  update public.shopling_price_bulk_jobs
  set pause_requested = false,status = v_status,updated_at = now()
  where id = p_job_id and owner_id = p_owner_id;
  return jsonb_build_object('status',v_status);
end;
$$;

create or replace function public.reserve_next_shopling_price_bulk_normal_chunk(
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
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9._:-]{1,120}$' then
    raise exception 'invalid request id';
  end if;

  select * into v_job
  from public.shopling_price_bulk_jobs
  where id = p_job_id and owner_id = p_owner_id
  for update;
  if v_job.id is null then raise exception 'job not found'; end if;
  if v_job.status = 'normal_paused' then
    return jsonb_build_object('paused',true,'status','normal_paused');
  end if;
  if v_job.status <> 'normal_running' then raise exception 'normal execution is not running'; end if;
  if v_job.pause_requested then
    update public.shopling_price_bulk_jobs
    set status = 'normal_paused',updated_at = now()
    where id = p_job_id and owner_id = p_owner_id;
    return jsonb_build_object('paused',true,'status','normal_paused');
  end if;
  if exists (
    select 1 from public.shopling_price_bulk_chunks
    where job_id = p_job_id and status in ('dispatching','running','dispatch_uncertain')
  ) then raise exception 'active chunk exists'; end if;

  select * into v_chunk
  from public.shopling_price_bulk_chunks
  where job_id = p_job_id
    and chunk_type = 'normal'
    and status = 'pending'
    and attempt_count = 0
  order by chunk_index asc
  limit 1
  for update skip locked;

  if v_chunk.id is null then
    if exists (
      select 1 from public.shopling_price_bulk_chunks
      where job_id = p_job_id
        and chunk_type = 'normal'
        and status not in ('succeeded','recovered')
    ) then raise exception 'no reservable normal chunk'; end if;

    update public.shopling_price_bulk_jobs
    set status = 'normal_succeeded',pause_requested = false,updated_at = now()
    where id = p_job_id and owner_id = p_owner_id;
    return jsonb_build_object('completed',true,'status','normal_succeeded');
  end if;

  update public.shopling_price_bulk_chunks
  set status = 'dispatching',
      request_id = p_request_id,
      attempt_count = attempt_count + 1,
      started_at = now(),
      updated_at = now(),
      last_error = null
  where id = v_chunk.id;

  return jsonb_build_object(
    'completed',false,
    'chunk_id',v_chunk.id,
    'chunk_index',v_chunk.chunk_index,
    'goods_keys',v_chunk.goods_keys,
    'goods_key_count',v_chunk.goods_key_count,
    'request_id',p_request_id,
    'policy_overrides',v_job.policy_overrides
  );
end;
$$;

create or replace function public.finish_shopling_price_bulk_normal_chunk(
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
  v_failed text[] := coalesce(p_failed_keys,array[]::text[]);
  v_remaining integer;
  v_pause boolean;
  v_status text;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  select chunk.* into v_chunk
  from public.shopling_price_bulk_chunks chunk
  join public.shopling_price_bulk_jobs job on job.id = chunk.job_id
  where chunk.job_id = p_job_id
    and job.owner_id = p_owner_id
    and chunk.chunk_type = 'normal'
    and chunk.request_id = p_request_id
    and chunk.status in ('dispatching','running','dispatch_uncertain')
  for update of chunk;
  if v_chunk.id is null then raise exception 'normal result transition not allowed'; end if;

  if exists (
    select 1
    from unnest(v_failed) as failed_key(value)
    where not exists (
      select 1
      from jsonb_array_elements_text(v_chunk.goods_keys) as chunk_key(value)
      where chunk_key.value = failed_key.value
    )
  ) then raise exception 'failed key outside chunk'; end if;
  if p_success and cardinality(v_failed) > 0 then raise exception 'success cannot include failed keys'; end if;

  if p_success then
    update public.shopling_price_bulk_items
    set status = 'succeeded',last_error = null,updated_at = now()
    where job_id = p_job_id
      and goods_key in (select jsonb_array_elements_text(v_chunk.goods_keys));
  elsif p_failure_scope_known then
    update public.shopling_price_bulk_items
    set status = case when goods_key = any(v_failed) then 'failed' else 'succeeded' end,
        last_error = case
          when goods_key = any(v_failed) then left(coalesce(p_error,'normal failed'),1000)
          else null
        end,
        updated_at = now()
    where job_id = p_job_id
      and goods_key in (select jsonb_array_elements_text(v_chunk.goods_keys));
  else
    update public.shopling_price_bulk_items
    set status = 'pending',
        last_error = left(coalesce(p_error,'normal failure scope unknown'),1000),
        updated_at = now()
    where job_id = p_job_id
      and goods_key in (select jsonb_array_elements_text(v_chunk.goods_keys));
  end if;

  update public.shopling_price_bulk_chunks
  set status = case when p_success then 'succeeded' else 'failed' end,
      result_summary = p_summary,
      actions_url = coalesce(p_run_url,actions_url),
      completed_at = now(),
      updated_at = now(),
      last_error = case when p_success then null else left(coalesce(p_error,'normal failed'),1000) end
  where id = v_chunk.id;

  select count(*) into v_remaining
  from public.shopling_price_bulk_chunks
  where job_id = p_job_id and chunk_type = 'normal' and status = 'pending';
  select pause_requested into v_pause
  from public.shopling_price_bulk_jobs
  where id = p_job_id and owner_id = p_owner_id
  for update;

  v_status := case
    when not p_success then 'normal_failed'
    when v_remaining = 0 then 'normal_succeeded'
    when v_pause then 'normal_paused'
    else 'normal_running'
  end;

  update public.shopling_price_bulk_jobs
  set status = v_status,
      pause_requested = (v_status = 'normal_paused'),
      updated_at = now(),
      last_error = case when p_success then null else left(coalesce(p_error,'normal failed'),1000) end
  where id = p_job_id and owner_id = p_owner_id;

  return jsonb_build_object(
    'status',v_status,
    'remaining_chunk_count',v_remaining,
    'chunk_index',v_chunk.chunk_index
  );
end;
$$;

create or replace function public.approve_shopling_price_bulk_normal_execution(
  p_job_id uuid,
  p_owner_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.shopling_price_bulk_jobs;
  v_chunks integer;
  v_goods integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;
  select * into v_job
  from public.shopling_price_bulk_jobs
  where id = p_job_id and owner_id = p_owner_id
  for update;
  if v_job.id is null then raise exception 'job not found'; end if;
  if v_job.status <> 'canary_succeeded' then raise exception 'canary has not succeeded'; end if;
  if not exists (
    select 1 from public.shopling_price_bulk_chunks
    where job_id = p_job_id
      and chunk_type = 'canary'
      and status in ('succeeded','recovered')
  ) then raise exception 'canary chunk has not succeeded'; end if;

  select count(*),coalesce(sum(goods_key_count),0) into v_chunks,v_goods
  from public.shopling_price_bulk_chunks
  where job_id = p_job_id and chunk_type = 'normal';
  if v_chunks = 0 then raise exception 'normal chunk is empty'; end if;
  if exists (
    select 1 from public.shopling_price_bulk_chunks
    where job_id = p_job_id and chunk_type = 'normal' and status <> 'pending'
  ) then raise exception 'all normal chunks must be pending'; end if;
  if exists (
    select 1 from public.shopling_price_bulk_chunks
    where job_id = p_job_id and status in ('dispatching','running','dispatch_uncertain')
  ) then raise exception 'active chunk exists'; end if;

  update public.shopling_price_bulk_jobs
  set status = 'normal_running',
      pause_requested = false,
      retry_scope_known = true,
      updated_at = now(),
      last_error = null
  where id = p_job_id and owner_id = p_owner_id;

  return jsonb_build_object(
    'status','normal_running',
    'normal_chunk_count',v_chunks,
    'normal_goods_key_count',v_goods
  );
end;
$$;

revoke all on function public.approve_shopling_price_bulk_failed_retry(uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_shopling_price_bulk_failed_retry(uuid,uuid) to service_role;
revoke all on function public.reserve_next_shopling_price_bulk_retry_chunk(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_next_shopling_price_bulk_retry_chunk(uuid,uuid,text) to service_role;
revoke all on function public.mark_shopling_price_bulk_retry_running(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.mark_shopling_price_bulk_retry_running(uuid,uuid,text,text) to service_role;
revoke all on function public.fail_shopling_price_bulk_retry_dispatch_rejected(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.fail_shopling_price_bulk_retry_dispatch_rejected(uuid,uuid,text,text) to service_role;
revoke all on function public.block_shopling_price_bulk_retry_uncertain(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.block_shopling_price_bulk_retry_uncertain(uuid,uuid,text,text) to service_role;
revoke all on function public.finish_shopling_price_bulk_retry_chunk(uuid,uuid,text,boolean,boolean,text[],jsonb,text,text) from public,anon,authenticated;
grant execute on function public.finish_shopling_price_bulk_retry_chunk(uuid,uuid,text,boolean,boolean,text[],jsonb,text,text) to service_role;
revoke all on function public.request_shopling_price_bulk_pause(uuid,uuid) from public,anon,authenticated;
grant execute on function public.request_shopling_price_bulk_pause(uuid,uuid) to service_role;
revoke all on function public.resume_shopling_price_bulk_execution(uuid,uuid) from public,anon,authenticated;
grant execute on function public.resume_shopling_price_bulk_execution(uuid,uuid) to service_role;
revoke all on function public.approve_shopling_price_bulk_normal_execution(uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_shopling_price_bulk_normal_execution(uuid,uuid) to service_role;
revoke all on function public.reserve_next_shopling_price_bulk_normal_chunk(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_next_shopling_price_bulk_normal_chunk(uuid,uuid,text) to service_role;
revoke all on function public.finish_shopling_price_bulk_normal_chunk(uuid,uuid,text,boolean,boolean,text[],jsonb,text,text) from public,anon,authenticated;
grant execute on function public.finish_shopling_price_bulk_normal_chunk(uuid,uuid,text,boolean,boolean,text[],jsonb,text,text) to service_role;
