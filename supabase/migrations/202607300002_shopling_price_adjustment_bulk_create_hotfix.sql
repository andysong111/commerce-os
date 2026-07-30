-- Repair the 10,000-item price-adjustment job creator after the original
-- migration referenced an unsupported JSON object-length helper. This
-- forward migration must be applied to databases where
-- 202607290001_shopling_price_adjustment_bulk_10000.sql already ran.

do $$
begin
  if exists (
    select 1
    from public.shopling_price_adjustment_bulk_jobs
    where status in ('prepared','running','paused','dispatch_uncertain')
    group by owner_id
    having count(*) > 1
  ) then
    raise exception 'multiple active price adjustment jobs exist for one owner';
  end if;
end $$;

create unique index if not exists shopling_price_adjustment_bulk_jobs_one_active_per_owner
  on public.shopling_price_adjustment_bulk_jobs(owner_id)
  where status in ('prepared','running','paused','dispatch_uncertain');

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
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_owner_id is null then
    raise exception 'owner required';
  end if;
  if p_input_source is null or p_input_source not in ('paste','csv','xlsx') then
    raise exception 'invalid input source';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be array';
  end if;

  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 10000 then
    raise exception 'row count must be 1..10000';
  end if;
  if p_original_count is null
     or p_duplicate_count is null
     or p_invalid_count is null
     or p_original_count < 0
     or p_duplicate_count < 0
     or p_invalid_count < 0
     or p_original_count <> v_count + p_duplicate_count + p_invalid_count then
    raise exception 'invalid statistics';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) elem
    where case
      when jsonb_typeof(elem) <> 'object' then true
      else
        (
          select count(*)
          from pg_catalog.jsonb_object_keys(elem)
        ) <> 2
        or not (elem ? 'goods_key')
        or not (elem ? 'adjustment_bps')
        or coalesce(elem->>'goods_key','') !~ '^\d+$'
        or case
          when coalesce(elem->>'adjustment_bps','') ~ '^-?\d+$' then
            (elem->>'adjustment_bps')::numeric not between -9999 and 100000
          else true
        end
    end
  ) then
    raise exception 'invalid adjustment row';
  end if;

  if (
    select count(distinct elem->>'goods_key')
    from jsonb_array_elements(p_rows) elem
  ) <> v_count then
    raise exception 'duplicate goods_key';
  end if;

  -- Serialize creation per owner inside the database transaction. The partial
  -- unique index remains the final invariant if another writer bypasses this
  -- routine.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_owner_id::text, 0)
  );
  if exists (
    select 1
    from public.shopling_price_adjustment_bulk_jobs
    where owner_id = p_owner_id
      and status in ('prepared','running','paused','dispatch_uncertain')
  ) then
    raise exception 'active price adjustment bulk job exists'
      using
        errcode = '23505',
        constraint = 'shopling_price_adjustment_bulk_jobs_one_active_per_owner';
  end if;

  v_canary := least(v_count, 10);
  v_chunks := 1 + ceil(greatest(v_count - 10, 0) / 50.0)::integer;

  insert into public.shopling_price_adjustment_bulk_jobs(
    owner_id,status,input_source,original_count,valid_count,duplicate_count,invalid_count,
    canary_size,chunk_size,total_chunk_count
  ) values (
    p_owner_id,'prepared',p_input_source,p_original_count,v_count,p_duplicate_count,p_invalid_count,
    v_canary,50,v_chunks
  ) returning * into v_job;

  insert into public.shopling_price_adjustment_bulk_items(
    job_id,goods_key,ordinal,adjustment_bps,status
  )
  select
    v_job.id,
    elem->>'goods_key',
    ordinal::integer,
    (elem->>'adjustment_bps')::integer,
    'pending'
  from jsonb_array_elements(p_rows) with ordinality value(elem, ordinal);

  insert into public.shopling_price_adjustment_bulk_chunks(
    job_id,chunk_index,chunk_type,input_rows,goods_key_count,status
  )
  select
    v_job.id,
    chunk_index,
    case when chunk_index = 0 then 'canary' else 'normal' end,
    jsonb_agg(
      jsonb_build_object(
        'goods_key',goods_key,
        'adjustment_bps',adjustment_bps
      )
      order by ordinal
    ),
    count(*)::integer,
    'pending'
  from (
    select
      elem->>'goods_key' as goods_key,
      (elem->>'adjustment_bps')::integer as adjustment_bps,
      ordinal,
      case
        when ordinal <= 10 then 0
        else 1 + ((ordinal - 11) / 50)::integer
      end as chunk_index
    from jsonb_array_elements(p_rows) with ordinality value(elem, ordinal)
  ) seeded
  group by chunk_index
  order by chunk_index;

  return v_job;
end $$;

revoke all on function public.create_shopling_price_adjustment_bulk_job(
  uuid,text,jsonb,integer,integer,integer
) from public, anon, authenticated;
grant execute on function public.create_shopling_price_adjustment_bulk_job(
  uuid,text,jsonb,integer,integer,integer
) to service_role;
