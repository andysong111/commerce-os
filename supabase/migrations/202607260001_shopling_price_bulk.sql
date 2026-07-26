create extension if not exists pgcrypto;

create table public.shopling_price_bulk_jobs (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  status text not null default 'queued' check (status in ('queued','running','paused','completed')),
  policy_overrides jsonb not null default '[]', total_items integer not null,
  last_error text, started_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now()
);
create table public.shopling_price_bulk_chunks (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.shopling_price_bulk_jobs(id) on delete cascade,
  kind text not null check (kind in ('canary','normal','retry')), sequence integer not null, attempt integer not null default 0,
  status text not null default 'pending' check (status in ('pending','dispatching','running','completed','failed','blocked')),
  goods_keys jsonb not null, request_id text, run_url text, claimed_at timestamptz, next_poll_at timestamptz,
  created_at timestamptz not null default now(), unique(job_id, sequence, attempt)
);
create unique index shopling_price_bulk_request_id_unique on public.shopling_price_bulk_chunks(request_id) where request_id is not null;
create table public.shopling_price_bulk_items (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.shopling_price_bulk_jobs(id) on delete cascade,
  goods_key text not null, ordinal integer not null, status text not null default 'pending'
    check (status in ('pending','running','retry_waiting','succeeded','final_failed')),
  attempt integer not null default 0, last_error text, updated_at timestamptz not null default now(), unique(job_id, goods_key)
);

alter table public.shopling_price_bulk_jobs enable row level security;
alter table public.shopling_price_bulk_chunks enable row level security;
alter table public.shopling_price_bulk_items enable row level security;
create policy "owners read bulk jobs" on public.shopling_price_bulk_jobs for select using (auth.uid() = owner_id);
create policy "owners read bulk chunks" on public.shopling_price_bulk_chunks for select using (exists(select 1 from public.shopling_price_bulk_jobs j where j.id=job_id and j.owner_id=auth.uid()));
create policy "owners read bulk items" on public.shopling_price_bulk_items for select using (exists(select 1 from public.shopling_price_bulk_jobs j where j.id=job_id and j.owner_id=auth.uid()));

create or replace function public.create_shopling_price_bulk_job(p_owner_id uuid, p_goods_keys text[], p_policy_overrides jsonb default '[]') returns uuid
language plpgsql security definer set search_path=public as $$
declare v_job uuid; v_key text; v_index integer; v_sequence integer := 0;
begin
  if auth.uid() is distinct from p_owner_id and auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  if coalesce(array_length(p_goods_keys,1),0) not between 1 and 20000 then raise exception 'goods_key count invalid'; end if;
  if (select count(distinct x) from unnest(p_goods_keys) x) <> array_length(p_goods_keys,1) then raise exception 'duplicate goods_key'; end if;
  if exists(select 1 from unnest(p_goods_keys) x where x !~ '^\d+$') then raise exception 'invalid goods_key'; end if;
  insert into shopling_price_bulk_jobs(owner_id,total_items,policy_overrides) values(p_owner_id,array_length(p_goods_keys,1),p_policy_overrides) returning id into v_job;
  for v_index in 1..array_length(p_goods_keys,1) loop insert into shopling_price_bulk_items(job_id,goods_key,ordinal) values(v_job,p_goods_keys[v_index],v_index-1); end loop;
  insert into shopling_price_bulk_chunks(job_id,kind,sequence,goods_keys) values(v_job,'canary',0,to_jsonb(p_goods_keys[1:least(10,array_length(p_goods_keys,1))]));
  v_index := 11; v_sequence := 1;
  while v_index <= array_length(p_goods_keys,1) loop insert into shopling_price_bulk_chunks(job_id,kind,sequence,goods_keys) values(v_job,'normal',v_sequence,to_jsonb(p_goods_keys[v_index:least(v_index+49,array_length(p_goods_keys,1))])); v_index:=v_index+50; v_sequence:=v_sequence+1; end loop;
  return v_job;
end $$;

create or replace function public.pause_shopling_price_bulk_dispatch_uncertain(p_chunk_id uuid,p_error text) returns void
language plpgsql security definer set search_path=public as $$
begin
 update shopling_price_bulk_chunks set status='blocked' where id=p_chunk_id;
 update shopling_price_bulk_jobs set status='paused',last_error=left(p_error,1000) where id=(select job_id from shopling_price_bulk_chunks where id=p_chunk_id);
end $$;

create or replace function public.set_shopling_price_bulk_job_status(p_job_id uuid,p_owner_id uuid,p_status text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if p_status not in ('paused','queued') then raise exception 'invalid status'; end if;
 update shopling_price_bulk_jobs set status=p_status where id=p_job_id and owner_id=p_owner_id;
 if not found then raise exception 'forbidden'; end if;
end $$;

create or replace function public.claim_shopling_price_bulk_chunk(p_request_id text) returns setof public.shopling_price_bulk_chunks
language plpgsql security definer set search_path=public as $$
begin
 return query update shopling_price_bulk_chunks c set status='dispatching',request_id=p_request_id,claimed_at=now()
 where c.id=(select c2.id from shopling_price_bulk_chunks c2 join shopling_price_bulk_jobs j on j.id=c2.job_id
  where j.status in ('queued','running') and c2.status='pending'
  and (c2.kind='canary' or exists(select 1 from shopling_price_bulk_chunks cc where cc.job_id=c2.job_id and cc.kind in ('canary','retry') and cc.status='completed'))
  order by j.created_at,c2.sequence for update of c2 skip locked limit 1) returning c.*;
end $$;
