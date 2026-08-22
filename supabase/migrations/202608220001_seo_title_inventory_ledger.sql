-- Commerce OS · SEO 상품명 재고 원장
-- 1688 링크 기반 상품명 재고를 제조·보관·예약·출고하기 위한 영구 원장.

create table if not exists public.seo_title_ledgers (
  ledger_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  ledger_key text not null,
  launch_item_id text not null default '',
  tracker_row_number integer,
  model_number text not null default '',
  source_url text not null,
  offer_id text not null default '',
  model_name text not null,
  model_name_source text not null default '',
  common_search_keywords text[] not null default '{}'::text[],
  common_search_line text not null default '',
  source_payload jsonb not null default '{}'::jsonb,
  engine_revision text not null default 'seo-title-inventory-v1',
  target_inventory_count integer not null default 145 check (target_inventory_count between 29 and 5000),
  status text not null default 'ready' check (status in ('draft','generating','ready','low_stock','needs_review','archived')),
  last_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, ledger_key),
  check (cardinality(common_search_keywords) <= 10),
  check (common_search_line = array_to_string(common_search_keywords, ','))
);

create index if not exists seo_title_ledgers_owner_updated_idx
  on public.seo_title_ledgers (owner_id, updated_at desc);
create index if not exists seo_title_ledgers_owner_launch_item_idx
  on public.seo_title_ledgers (owner_id, launch_item_id)
  where launch_item_id <> '';
create index if not exists seo_title_ledgers_owner_model_number_idx
  on public.seo_title_ledgers (owner_id, model_number)
  where model_number <> '';
create index if not exists seo_title_ledgers_owner_offer_idx
  on public.seo_title_ledgers (owner_id, offer_id)
  where offer_id <> '';

create table if not exists public.seo_title_inventory (
  title_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  ledger_id uuid not null references public.seo_title_ledgers(ledger_id) on delete cascade,
  product_group text not null check (product_group in ('도매1','도매2','도매3','도매4','소매1','소매2')),
  title text not null,
  title_fingerprint text not null,
  semantic_fingerprint text not null,
  generation_batch integer not null default 1 check (generation_batch > 0),
  quality_score numeric(8,3) not null default 0,
  source_materials text[] not null default '{}'::text[],
  status text not null default 'available' check (status in ('available','reserved','used','review','rejected')),
  reservation_id uuid,
  reservation_expires_at timestamptz,
  reserved_at timestamptz,
  used_at timestamptz,
  dispatch_id uuid,
  mall_key text not null default '',
  goods_key text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ledger_id, title_fingerprint),
  unique (ledger_id, semantic_fingerprint),
  check (octet_length(title) <= 50),
  check (
    (status = 'reserved' and reservation_id is not null and reservation_expires_at is not null)
    or (status <> 'reserved')
  )
);

create index if not exists seo_title_inventory_available_idx
  on public.seo_title_inventory (owner_id, ledger_id, product_group, quality_score desc, created_at)
  where status = 'available';
create index if not exists seo_title_inventory_reservation_idx
  on public.seo_title_inventory (owner_id, reservation_id)
  where reservation_id is not null;
create index if not exists seo_title_inventory_dispatch_idx
  on public.seo_title_inventory (owner_id, dispatch_id)
  where dispatch_id is not null;

create table if not exists public.seo_title_dispatches (
  dispatch_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  ledger_id uuid not null references public.seo_title_ledgers(ledger_id) on delete cascade,
  reservation_id uuid not null,
  launch_item_id text not null default '',
  dispatch_kind text not null default 'shopling_prepare' check (dispatch_kind in ('shopling_prepare','shopling_update','inventory_only')),
  status text not null default 'reserved' check (status in ('reserved','ready','submitted','success','partial','failed','cancelled','expired')),
  registration_rounds integer not null default 1 check (registration_rounds between 1 and 50),
  requested_title_count integer not null default 29 check (requested_title_count between 1 and 1450),
  reserved_title_count integer not null default 0 check (reserved_title_count >= 0),
  common_search_line text not null default '',
  execution_plan jsonb not null default '[]'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  external_request_id text not null default '',
  reservation_expires_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, reservation_id)
);

create index if not exists seo_title_dispatches_owner_updated_idx
  on public.seo_title_dispatches (owner_id, updated_at desc);
create index if not exists seo_title_dispatches_ledger_idx
  on public.seo_title_dispatches (owner_id, ledger_id, created_at desc);

create table if not exists public.seo_title_dispatch_items (
  dispatch_item_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  dispatch_id uuid not null references public.seo_title_dispatches(dispatch_id) on delete cascade,
  ledger_id uuid not null references public.seo_title_ledgers(ledger_id) on delete cascade,
  title_id uuid not null references public.seo_title_inventory(title_id),
  product_group text not null,
  market_name text not null default '',
  mall_key text not null default '',
  account_id_label text not null default '',
  goods_key text not null default '',
  title text not null,
  common_search_line text not null default '',
  status text not null default 'reserved' check (status in ('reserved','ready','submitted','success','failed','cancelled')),
  error_message text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dispatch_id, title_id),
  unique (dispatch_id, product_group, mall_key, account_id_label)
);

create index if not exists seo_title_dispatch_items_dispatch_idx
  on public.seo_title_dispatch_items (owner_id, dispatch_id, product_group);

alter table public.seo_title_ledgers enable row level security;
alter table public.seo_title_inventory enable row level security;
alter table public.seo_title_dispatches enable row level security;
alter table public.seo_title_dispatch_items enable row level security;

revoke all on public.seo_title_ledgers from anon, authenticated;
revoke all on public.seo_title_inventory from anon, authenticated;
revoke all on public.seo_title_dispatches from anon, authenticated;
revoke all on public.seo_title_dispatch_items from anon, authenticated;

grant select, insert, update, delete on public.seo_title_ledgers to service_role;
grant select, insert, update, delete on public.seo_title_inventory to service_role;
grant select, insert, update, delete on public.seo_title_dispatches to service_role;
grant select, insert, update, delete on public.seo_title_dispatch_items to service_role;

create or replace function public.touch_seo_title_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.touch_seo_title_ledger_from_inventory()
returns trigger
language plpgsql
as $$
begin
  update public.seo_title_ledgers
  set updated_at = now()
  where ledger_id = coalesce(new.ledger_id, old.ledger_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists seo_title_ledgers_touch_updated_at on public.seo_title_ledgers;
create trigger seo_title_ledgers_touch_updated_at
before update on public.seo_title_ledgers
for each row execute function public.touch_seo_title_updated_at();

drop trigger if exists seo_title_inventory_touch_updated_at on public.seo_title_inventory;
create trigger seo_title_inventory_touch_updated_at
before update on public.seo_title_inventory
for each row execute function public.touch_seo_title_updated_at();

drop trigger if exists seo_title_inventory_touch_ledger on public.seo_title_inventory;
create trigger seo_title_inventory_touch_ledger
after insert or update or delete on public.seo_title_inventory
for each row execute function public.touch_seo_title_ledger_from_inventory();

drop trigger if exists seo_title_dispatches_touch_updated_at on public.seo_title_dispatches;
create trigger seo_title_dispatches_touch_updated_at
before update on public.seo_title_dispatches
for each row execute function public.touch_seo_title_updated_at();

drop trigger if exists seo_title_dispatch_items_touch_updated_at on public.seo_title_dispatch_items;
create trigger seo_title_dispatch_items_touch_updated_at
before update on public.seo_title_dispatch_items
for each row execute function public.touch_seo_title_updated_at();

create or replace view public.seo_title_ledger_inventory_stats
with (security_invoker = true)
as
select
  l.ledger_id,
  l.owner_id,
  l.ledger_key,
  l.launch_item_id,
  l.tracker_row_number,
  l.model_number,
  l.source_url,
  l.offer_id,
  l.model_name,
  l.model_name_source,
  l.common_search_keywords,
  l.common_search_line,
  l.engine_revision,
  l.target_inventory_count,
  l.status,
  l.last_generated_at,
  l.created_at,
  l.updated_at,
  count(i.title_id)::integer as total_count,
  count(i.title_id) filter (where i.status = 'available')::integer as available_count,
  count(i.title_id) filter (where i.status = 'reserved')::integer as reserved_count,
  count(i.title_id) filter (where i.status = 'used')::integer as used_count,
  count(i.title_id) filter (where i.status = 'review')::integer as review_count,
  count(i.title_id) filter (where i.status = 'rejected')::integer as rejected_count,
  count(i.title_id) filter (where i.status = 'available' and i.product_group = '도매1')::integer as available_wholesale1,
  count(i.title_id) filter (where i.status = 'available' and i.product_group = '도매2')::integer as available_wholesale2,
  count(i.title_id) filter (where i.status = 'available' and i.product_group = '도매3')::integer as available_wholesale3,
  count(i.title_id) filter (where i.status = 'available' and i.product_group = '도매4')::integer as available_wholesale4,
  count(i.title_id) filter (where i.status = 'available' and i.product_group = '소매1')::integer as available_retail1,
  count(i.title_id) filter (where i.status = 'available' and i.product_group = '소매2')::integer as available_retail2,
  least(
    (count(i.title_id) filter (where i.status = 'available' and i.product_group = '도매1') / 5)::integer,
    (count(i.title_id) filter (where i.status = 'available' and i.product_group = '도매2') / 3)::integer,
    (count(i.title_id) filter (where i.status = 'available' and i.product_group = '도매3') / 3)::integer,
    (count(i.title_id) filter (where i.status = 'available' and i.product_group = '도매4') / 1)::integer,
    (count(i.title_id) filter (where i.status = 'available' and i.product_group = '소매1') / 12)::integer,
    (count(i.title_id) filter (where i.status = 'available' and i.product_group = '소매2') / 5)::integer
  ) as full_market_rounds_available,
  greatest(
    l.target_inventory_count - count(i.title_id) filter (where i.status in ('available','reserved')),
    0
  )::integer as replenishment_needed_count,
  (select count(*)::integer from public.seo_title_dispatches d where d.ledger_id = l.ledger_id and d.owner_id = l.owner_id) as dispatch_count
from public.seo_title_ledgers l
left join public.seo_title_inventory i
  on i.ledger_id = l.ledger_id and i.owner_id = l.owner_id
group by l.ledger_id;

revoke all on public.seo_title_ledger_inventory_stats from anon, authenticated;
grant select on public.seo_title_ledger_inventory_stats to service_role;

create or replace function public.reserve_seo_title_inventory(
  p_owner_id uuid,
  p_ledger_id uuid,
  p_group_counts jsonb,
  p_reservation_id uuid default gen_random_uuid(),
  p_ttl_minutes integer default 30
)
returns table (
  title_id uuid,
  ledger_id uuid,
  product_group text,
  title text,
  quality_score numeric,
  source_materials text[],
  reservation_id uuid,
  reservation_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  group_row record;
  requested_count integer;
  picked_count integer;
  expiry timestamptz := now() + make_interval(mins => greatest(5, least(coalesce(p_ttl_minutes, 30), 240)));
begin
  if not exists (
    select 1 from public.seo_title_ledgers
    where seo_title_ledgers.ledger_id = p_ledger_id
      and seo_title_ledgers.owner_id = p_owner_id
  ) then
    raise exception 'SEO_TITLE_LEDGER_NOT_FOUND';
  end if;

  update public.seo_title_inventory
  set status = 'available',
      reservation_id = null,
      reservation_expires_at = null,
      reserved_at = null,
      dispatch_id = null,
      mall_key = '',
      goods_key = ''
  where owner_id = p_owner_id
    and ledger_id = p_ledger_id
    and status = 'reserved'
    and reservation_expires_at < now();

  for group_row in
    select key as product_group, value as requested
    from jsonb_each_text(coalesce(p_group_counts, '{}'::jsonb))
  loop
    if group_row.product_group not in ('도매1','도매2','도매3','도매4','소매1','소매2') then
      raise exception 'SEO_TITLE_INVALID_PRODUCT_GROUP:%', group_row.product_group;
    end if;
    requested_count := group_row.requested::integer;
    if requested_count < 0 or requested_count > 600 then
      raise exception 'SEO_TITLE_INVALID_RESERVATION_COUNT:%', requested_count;
    end if;
    if requested_count = 0 then
      continue;
    end if;

    return query
    with picked as (
      select i.title_id
      from public.seo_title_inventory i
      where i.owner_id = p_owner_id
        and i.ledger_id = p_ledger_id
        and i.product_group = group_row.product_group
        and i.status = 'available'
      order by i.quality_score desc, i.created_at, i.title_id
      limit requested_count
      for update skip locked
    ), updated as (
      update public.seo_title_inventory i
      set status = 'reserved',
          reservation_id = p_reservation_id,
          reservation_expires_at = expiry,
          reserved_at = now()
      where i.title_id in (select picked.title_id from picked)
      returning i.title_id, i.ledger_id, i.product_group, i.title,
                i.quality_score, i.source_materials, i.reservation_id,
                i.reservation_expires_at
    )
    select updated.title_id, updated.ledger_id, updated.product_group,
           updated.title, updated.quality_score, updated.source_materials,
           updated.reservation_id, updated.reservation_expires_at
    from updated;

    get diagnostics picked_count = row_count;
    if picked_count <> requested_count then
      raise exception 'SEO_TITLE_INVENTORY_SHORTAGE:%:%:%', group_row.product_group, requested_count, picked_count;
    end if;
  end loop;
end;
$$;

create or replace function public.release_seo_title_reservation(
  p_owner_id uuid,
  p_reservation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.seo_title_inventory
  set status = 'available',
      reservation_id = null,
      reservation_expires_at = null,
      reserved_at = null,
      dispatch_id = null,
      mall_key = '',
      goods_key = ''
  where owner_id = p_owner_id
    and reservation_id = p_reservation_id
    and status = 'reserved';
  get diagnostics affected = row_count;

  update public.seo_title_dispatches
  set status = 'cancelled', completed_at = now()
  where owner_id = p_owner_id
    and reservation_id = p_reservation_id
    and status in ('reserved','ready');

  return affected;
end;
$$;

create or replace function public.finalize_seo_title_reservation(
  p_owner_id uuid,
  p_reservation_id uuid,
  p_dispatch_id uuid,
  p_success boolean
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  if p_success then
    update public.seo_title_inventory
    set status = 'used',
        dispatch_id = p_dispatch_id,
        used_at = now(),
        reservation_expires_at = null
    where owner_id = p_owner_id
      and reservation_id = p_reservation_id
      and status = 'reserved';
  else
    update public.seo_title_inventory
    set status = 'review',
        dispatch_id = p_dispatch_id,
        reservation_expires_at = null
    where owner_id = p_owner_id
      and reservation_id = p_reservation_id
      and status = 'reserved';
  end if;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.reserve_seo_title_inventory(uuid, uuid, jsonb, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_seo_title_reservation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finalize_seo_title_reservation(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.reserve_seo_title_inventory(uuid, uuid, jsonb, uuid, integer) to service_role;
grant execute on function public.release_seo_title_reservation(uuid, uuid) to service_role;
grant execute on function public.finalize_seo_title_reservation(uuid, uuid, uuid, boolean) to service_role;
