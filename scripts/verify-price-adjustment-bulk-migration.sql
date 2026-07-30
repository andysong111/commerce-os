\set ON_ERROR_STOP on

begin;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'authenticated'
  ) then
    create role authenticated nologin;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'service_role'
  ) then
    create role service_role nologin;
  end if;
end $$;

create schema if not exists auth;
create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  )
$$;

\ir ../supabase/migrations/202607290001_shopling_price_adjustment_bulk_10000.sql
\ir ../supabase/migrations/202607290002_shopling_price_adjustment_bulk_failures.sql
\ir ../supabase/migrations/202607300002_shopling_price_adjustment_bulk_create_hotfix.sql

set local request.jwt.claim.role = 'service_role';

do $$
declare
  v_job public.shopling_price_adjustment_bulk_jobs;
  v_owner uuid := gen_random_uuid();
  v_invalid_owner uuid := gen_random_uuid();
  v_rows jsonb;
  v_count integer;
begin
  select jsonb_agg(
    jsonb_build_object(
      'goods_key',
      (100000 + value)::text,
      'adjustment_bps',
      1000
    )
    order by value
  )
  into v_rows
  from generate_series(1, 1000) value;

  select *
  into v_job
  from public.create_shopling_price_adjustment_bulk_job(
    v_owner,
    'paste',
    v_rows,
    1000,
    0,
    0
  );

  if v_job.status <> 'prepared'
     or v_job.valid_count <> 1000
     or v_job.canary_size <> 10
     or v_job.chunk_size <> 50
     or v_job.total_chunk_count <> 21 then
    raise exception 'unexpected 1000-row job metadata';
  end if;

  select count(*)
  into v_count
  from public.shopling_price_adjustment_bulk_items
  where job_id = v_job.id;
  if v_count <> 1000 then
    raise exception 'expected 1000 items, got %', v_count;
  end if;

  select count(*)
  into v_count
  from public.shopling_price_adjustment_bulk_chunks
  where job_id = v_job.id;
  if v_count <> 21 then
    raise exception 'expected 21 chunks, got %', v_count;
  end if;

  if not exists (
    select 1
    from public.shopling_price_adjustment_bulk_chunks
    where job_id = v_job.id
      and chunk_index = 0
      and chunk_type = 'canary'
      and goods_key_count = 10
  ) then
    raise exception '10-row canary chunk is missing';
  end if;

  select count(*)
  into v_count
  from public.shopling_price_adjustment_bulk_chunks
  where job_id = v_job.id
    and chunk_index between 1 and 19
    and goods_key_count = 50;
  if v_count <> 19 then
    raise exception 'expected 19 full normal chunks, got %', v_count;
  end if;

  if not exists (
    select 1
    from public.shopling_price_adjustment_bulk_chunks
    where job_id = v_job.id
      and chunk_index = 20
      and chunk_type = 'normal'
      and goods_key_count = 40
  ) then
    raise exception '40-row final chunk is missing';
  end if;

  begin
    perform public.create_shopling_price_adjustment_bulk_job(
      v_invalid_owner,
      'paste',
      '[{"goods_key":"1","adjustment_bps":1000,"extra":true}]'::jsonb,
      1,
      0,
      0
    );
    raise exception 'expected invalid adjustment row rejection';
  exception
    when others then
      if sqlerrm <> 'invalid adjustment row' then
        raise;
      end if;
  end;

  if exists (
    select 1
    from public.shopling_price_adjustment_bulk_jobs
    where owner_id = v_invalid_owner
  ) then
    raise exception 'invalid input persisted a job';
  end if;

  begin
    perform public.create_shopling_price_adjustment_bulk_job(
      v_owner,
      'paste',
      '[{"goods_key":"999999","adjustment_bps":1000}]'::jsonb,
      1,
      0,
      0
    );
    raise exception 'expected active-job uniqueness rejection';
  exception
    when unique_violation then null;
  end;

  select count(*)
  into v_count
  from public.shopling_price_adjustment_bulk_jobs
  where owner_id = v_owner
    and status in ('prepared','running','paused','dispatch_uncertain');
  if v_count <> 1 then
    raise exception 'expected exactly one active job, got %', v_count;
  end if;
end $$;

rollback;
