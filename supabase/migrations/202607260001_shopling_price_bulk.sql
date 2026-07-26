create extension if not exists pgcrypto;

create table if not exists public.shopling_price_bulk_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('queued','canary_running','running','paused','completed','completed_with_failures','cancelled')),
  input_source text not null check (input_source in ('csv','xlsx','paste')),
  total_input_count integer not null, valid_goods_key_count integer not null check (valid_goods_key_count between 1 and 20000), duplicate_count integer not null default 0, invalid_count integer not null default 0,
  chunk_size integer not null default 50 check (chunk_size = 50), max_parallel integer not null default 1 check (max_parallel between 1 and 2), total_chunk_count integer not null,
  completed_chunk_count integer not null default 0, success_goods_key_count integer not null default 0, failed_goods_key_count integer not null default 0, retry_goods_key_count integer not null default 0, consecutive_failure_count integer not null default 0,
  policy_overrides jsonb not null default '[]', last_error text, retry_of_job_id uuid references public.shopling_price_bulk_jobs(id) on delete set null,
  created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz, updated_at timestamptz not null default now()
);
create table if not exists public.shopling_price_bulk_chunks (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.shopling_price_bulk_jobs(id) on delete cascade,
  chunk_index integer not null, chunk_type text not null check (chunk_type in ('canary','normal','retry')), goods_keys jsonb not null check (jsonb_typeof(goods_keys) = 'array' and jsonb_array_length(goods_keys) between 1 and 50),
  status text not null check (status in ('pending','dispatching','running','succeeded','retry_waiting','failed','cancelled')), attempt_count integer not null default 0,
  request_id text, github_run_id bigint, github_run_url text, result_summary jsonb, failed_goods_keys jsonb not null default '[]', policy_overrides jsonb not null default '[]', error_message text, retry_after timestamptz,
  dispatched_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(job_id, chunk_index, chunk_type)
);
create index if not exists shopling_price_bulk_chunks_work_idx on public.shopling_price_bulk_chunks(status, retry_after, created_at);
alter table public.shopling_price_bulk_jobs enable row level security;
alter table public.shopling_price_bulk_chunks enable row level security;
revoke all on public.shopling_price_bulk_jobs, public.shopling_price_bulk_chunks from anon, authenticated;

-- All RPCs are service-role only. SKIP LOCKED makes overlapping cron invocations claim distinct work.
create or replace function public.shopling_price_bulk_running_chunks() returns setof public.shopling_price_bulk_chunks language sql security definer set search_path = public as $$
  select c.* from shopling_price_bulk_chunks c join shopling_price_bulk_jobs j on j.id=c.job_id where c.status='running' and j.status in ('canary_running','running','paused') order by c.dispatched_at limit 20;
$$;
create or replace function public.shopling_price_bulk_claim_next() returns setof public.shopling_price_bulk_chunks language plpgsql security definer set search_path = public as $$
declare claimed shopling_price_bulk_chunks;
begin
  select c.* into claimed from shopling_price_bulk_chunks c join shopling_price_bulk_jobs j on j.id=c.job_id
  where j.status in ('queued','canary_running','running') and c.status in ('pending','retry_waiting') and (c.retry_after is null or c.retry_after <= now())
    and not exists (select 1 from shopling_price_bulk_chunks active where active.job_id=j.id and active.status in ('dispatching','running'))
    and (c.chunk_type in ('canary','retry') or exists (select 1 from shopling_price_bulk_chunks gate where gate.job_id=j.id and gate.chunk_type in ('canary','retry') and gate.status='succeeded'))
  order by j.created_at,c.chunk_index for update of c skip locked limit 1;
  if claimed.id is null then return; end if;
  update shopling_price_bulk_chunks set status='dispatching',attempt_count=attempt_count+1,updated_at=now() where id=claimed.id returning * into claimed;
  update shopling_price_bulk_jobs set status=case when claimed.chunk_type='canary' then 'canary_running' else 'running' end,started_at=coalesce(started_at,now()),updated_at=now() where id=claimed.job_id;
  return next claimed;
end $$;
-- Return a failed dispatch to a retryable state; no external request_id was persisted.
create or replace function public.shopling_price_bulk_release_claim(p_chunk_id uuid,p_error text) returns void language plpgsql security definer set search_path=public as $$ begin
 update shopling_price_bulk_chunks set status='retry_waiting',retry_after=now()+interval '1 minute',error_message=left(p_error,500),updated_at=now() where id=p_chunk_id and status='dispatching';
end $$;
create or replace function public.shopling_price_bulk_complete_chunk(p_chunk_id uuid,p_summary jsonb,p_run_id bigint,p_run_url text) returns void language plpgsql security definer set search_path=public as $$
declare c shopling_price_bulk_chunks; remaining integer; failures integer;
begin update shopling_price_bulk_chunks set status='succeeded',result_summary=p_summary,github_run_id=p_run_id,github_run_url=p_run_url,failed_goods_keys='[]',completed_at=now(),updated_at=now() where id=p_chunk_id and status='running' returning * into c; if c.id is null then return; end if;
 update shopling_price_bulk_jobs set completed_chunk_count=completed_chunk_count+1,success_goods_key_count=success_goods_key_count+jsonb_array_length(c.goods_keys),consecutive_failure_count=0,updated_at=now() where id=c.job_id;
 select count(*) into remaining from shopling_price_bulk_chunks where job_id=c.job_id and status in ('pending','dispatching','running','retry_waiting');
 if remaining=0 then select failed_goods_key_count into failures from shopling_price_bulk_jobs where id=c.job_id; update shopling_price_bulk_jobs set status=case when failures=0 then 'completed' else 'completed_with_failures' end,finished_at=now(),updated_at=now() where id=c.job_id; elsif c.chunk_type='canary' then update shopling_price_bulk_jobs set status='running',updated_at=now() where id=c.job_id; end if;
end $$;
create or replace function public.shopling_price_bulk_fail_chunk(p_chunk_id uuid,p_failed_goods_keys jsonb,p_summary jsonb,p_error text) returns void language plpgsql security definer set search_path=public as $$
declare c shopling_price_bulk_chunks; next_index integer; failure_count integer; remaining integer;
begin select * into c from shopling_price_bulk_chunks where id=p_chunk_id for update; if c.status<>'running' then return; end if;
 if c.attempt_count <= 2 then
   update shopling_price_bulk_chunks set status='failed',result_summary=p_summary,failed_goods_keys=p_failed_goods_keys,error_message=left(p_error,500),completed_at=now(),updated_at=now() where id=c.id;
   select coalesce(max(chunk_index),0)+1 into next_index from shopling_price_bulk_chunks where job_id=c.job_id;
   insert into shopling_price_bulk_chunks(job_id,chunk_index,chunk_type,goods_keys,status,attempt_count,retry_after,policy_overrides) values(c.job_id,next_index,'retry',p_failed_goods_keys,'retry_waiting',c.attempt_count,now()+(interval '1 minute'*power(2,c.attempt_count-1)),c.policy_overrides);
   update shopling_price_bulk_jobs set retry_goods_key_count=retry_goods_key_count+jsonb_array_length(p_failed_goods_keys),total_chunk_count=total_chunk_count+1,last_error=left(p_error,500),status=case when c.chunk_type='canary' then 'paused' else status end,updated_at=now() where id=c.job_id;
 else
   update shopling_price_bulk_chunks set status='failed',result_summary=p_summary,failed_goods_keys=p_failed_goods_keys,error_message=left(p_error,500),completed_at=now(),updated_at=now() where id=c.id;
   update shopling_price_bulk_jobs set completed_chunk_count=completed_chunk_count+1,failed_goods_key_count=failed_goods_key_count+jsonb_array_length(p_failed_goods_keys),consecutive_failure_count=consecutive_failure_count+1,last_error=left(p_error,500),updated_at=now() where id=c.job_id returning consecutive_failure_count into failure_count;
   if failure_count>=3 or p_error~*'(github.*auth|shopling.*auth|credential|environment|환경변수|policy)' then update shopling_price_bulk_jobs set status='paused' where id=c.job_id; end if;
 end if;
 select count(*) into remaining from shopling_price_bulk_chunks where job_id=c.job_id and status in ('pending','dispatching','running','retry_waiting');
 if remaining=0 then update shopling_price_bulk_jobs set status=case when failed_goods_key_count=0 then 'completed' else 'completed_with_failures' end,finished_at=now(),updated_at=now() where id=c.job_id and status<>'paused'; end if;
end $$;
revoke all on function public.shopling_price_bulk_running_chunks(), public.shopling_price_bulk_claim_next(), public.shopling_price_bulk_release_claim(uuid,text), public.shopling_price_bulk_complete_chunk(uuid,jsonb,bigint,text), public.shopling_price_bulk_fail_chunk(uuid,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.shopling_price_bulk_running_chunks(), public.shopling_price_bulk_claim_next(), public.shopling_price_bulk_release_claim(uuid,text), public.shopling_price_bulk_complete_chunk(uuid,jsonb,bigint,text), public.shopling_price_bulk_fail_chunk(uuid,jsonb,jsonb,text) to service_role;
