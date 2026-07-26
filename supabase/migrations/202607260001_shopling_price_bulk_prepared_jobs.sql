create extension if not exists pgcrypto;

create table public.shopling_price_bulk_jobs (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, status text not null check (status in ('prepared', 'cancelled')),
  input_source text not null check (input_source in ('paste', 'csv', 'xlsx')), original_count integer not null check (original_count >= 0),
  valid_count integer not null check (valid_count > 0), duplicate_count integer not null check (duplicate_count >= 0), invalid_count integer not null check (invalid_count >= 0),
  canary_size integer not null, normal_chunk_size integer not null, total_chunk_count integer not null,
  policy_overrides jsonb not null default '[]'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.shopling_price_bulk_items (
  job_id uuid not null references public.shopling_price_bulk_jobs(id) on delete cascade, goods_key text not null, ordinal integer not null,
  is_canary boolean not null, status text not null check (status = 'pending'), attempt_count integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (job_id, goods_key)
);
create table public.shopling_price_bulk_chunks (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.shopling_price_bulk_jobs(id) on delete cascade,
  chunk_index integer not null, chunk_type text not null check (chunk_type in ('canary', 'normal')), goods_keys jsonb not null,
  goods_key_count integer not null, status text not null check (status = 'pending'), attempt_count integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (job_id, chunk_index)
);

alter table public.shopling_price_bulk_jobs enable row level security;
alter table public.shopling_price_bulk_items enable row level security;
alter table public.shopling_price_bulk_chunks enable row level security;
revoke all on public.shopling_price_bulk_jobs, public.shopling_price_bulk_items, public.shopling_price_bulk_chunks from anon, authenticated;

create or replace function public.create_shopling_price_bulk_prepared_job(
  p_owner_id uuid, p_input_source text, p_goods_keys text[], p_original_count integer, p_duplicate_count integer, p_invalid_count integer
) returns public.shopling_price_bulk_jobs language plpgsql security definer set search_path = public as $$
declare v_job public.shopling_price_bulk_jobs; v_count integer; v_canary integer; v_chunk_count integer;
begin
  v_count := coalesce(cardinality(p_goods_keys), 0);
  if v_count = 0 then raise exception 'empty goods keys'; end if;
  if v_count > 20000 then raise exception 'too many goods keys'; end if;
  if p_input_source not in ('paste', 'csv', 'xlsx') then raise exception 'invalid input source'; end if;
  if p_original_count < 0 or p_duplicate_count < 0 or p_invalid_count < 0 or p_original_count <> v_count + p_duplicate_count + p_invalid_count then raise exception 'invalid statistics'; end if;
  if exists (select 1 from unnest(p_goods_keys) key where key !~ '^\d+$') then raise exception 'invalid goods key'; end if;
  if (select count(distinct key) from unnest(p_goods_keys) key) <> v_count then raise exception 'duplicate goods key'; end if;
  v_canary := least(v_count, 10); v_chunk_count := 1 + ceil(greatest(v_count - 10, 0) / 50.0)::integer;
  insert into public.shopling_price_bulk_jobs(owner_id,status,input_source,original_count,valid_count,duplicate_count,invalid_count,canary_size,normal_chunk_size,total_chunk_count,policy_overrides)
    values(p_owner_id,'prepared',p_input_source,p_original_count,v_count,p_duplicate_count,p_invalid_count,v_canary,50,v_chunk_count,'[]'::jsonb) returning * into v_job;
  insert into public.shopling_price_bulk_items(job_id,goods_key,ordinal,is_canary,status,attempt_count)
    select v_job.id, key, ordinal, ordinal <= 10, 'pending', 0 from unnest(p_goods_keys) with ordinality value(key, ordinal);
  insert into public.shopling_price_bulk_chunks(job_id,chunk_index,chunk_type,goods_keys,goods_key_count,status,attempt_count)
    select v_job.id, chunk_index, case when chunk_index=0 then 'canary' else 'normal' end,
      to_jsonb(array_agg(key order by ordinal)), count(*)::integer, 'pending', 0
    from (select key, ordinal, case when ordinal <= 10 then 0 else 1 + ((ordinal - 11) / 50)::integer end chunk_index from unnest(p_goods_keys) with ordinality value(key, ordinal)) seeds
    group by chunk_index order by chunk_index;
  return v_job;
end $$;
revoke all on function public.create_shopling_price_bulk_prepared_job(uuid,text,text[],integer,integer,integer) from public, anon, authenticated;
grant execute on function public.create_shopling_price_bulk_prepared_job(uuid,text,text[],integer,integer,integer) to service_role;
