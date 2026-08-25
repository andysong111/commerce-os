create table if not exists public.shopling_product_group_registry (
  owner_id uuid not null,
  goods_key text not null,
  launch_item_id text not null default '',
  model_number text not null default '',
  product_group_key text not null check (product_group_key in ('wholesale1','wholesale2','wholesale3','wholesale4','retail1','retail2')),
  product_group_label text not null check (product_group_label in ('도매1','도매2','도매3','도매4','소매1','소매2')),
  ptn_goods_cd text not null default '',
  search_prefix text not null check (search_prefix in ('DM1_','DM2_','DM3_','DM4_','SM1_','SM2_')),
  code_format text not null default 'group_prefix' check (code_format in ('legacy_suffix','group_prefix')),
  shopling_status text not null default '',
  registered_at timestamptz,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, goods_key)
);

comment on table public.shopling_product_group_registry is
  'Permanent mapping of Shopling goods_key to Commerce OS product group and searchable partner product code.';
comment on column public.shopling_product_group_registry.search_prefix is
  'Human-searchable Shopling self-code prefix: DM1_/DM2_/DM3_/DM4_/SM1_/SM2_.';

create index if not exists shopling_product_group_registry_owner_group_idx
  on public.shopling_product_group_registry (owner_id, product_group_key, updated_at desc);
create index if not exists shopling_product_group_registry_owner_item_idx
  on public.shopling_product_group_registry (owner_id, launch_item_id, updated_at desc);
create index if not exists shopling_product_group_registry_owner_ptn_idx
  on public.shopling_product_group_registry (owner_id, ptn_goods_cd);

alter table public.shopling_product_group_registry enable row level security;
revoke all on public.shopling_product_group_registry from anon, authenticated;
grant select, insert, update, delete on public.shopling_product_group_registry to service_role;

with channel_map(channel_key, group_label, search_prefix, legacy_suffix) as (
  values
    ('wholesale1','도매1','DM1_','a'),
    ('wholesale2','도매2','DM2_','b'),
    ('wholesale3','도매3','DM3_','c'),
    ('wholesale4','도매4','DM4_','d'),
    ('retail1','소매1','SM1_','e'),
    ('retail2','소매2','SM2_','f')
), expanded as (
  select
    p.owner_id,
    p.item_id,
    p.model_number,
    p.self_code_base,
    e.key as channel_key,
    e.value as product,
    m.group_label,
    m.search_prefix,
    m.legacy_suffix
  from public.product_launch_items p
  cross join lateral jsonb_each(coalesce(p.item_payload->'shoplingProducts','{}'::jsonb)) e
  join channel_map m on m.channel_key = e.key
)
insert into public.shopling_product_group_registry (
  owner_id,
  goods_key,
  launch_item_id,
  model_number,
  product_group_key,
  product_group_label,
  ptn_goods_cd,
  search_prefix,
  code_format,
  shopling_status,
  registered_at,
  first_seen_at,
  updated_at
)
select
  owner_id,
  product->>'goodsKey',
  item_id,
  model_number,
  channel_key,
  group_label,
  self_code_base || legacy_suffix,
  search_prefix,
  'legacy_suffix',
  coalesce(product->>'status',''),
  case
    when coalesce(product->>'registeredAt','') ~ '^\d{4}-\d{2}-\d{2}T'
      then (product->>'registeredAt')::timestamptz
    else null
  end,
  now(),
  now()
from expanded
where coalesce(product->>'goodsKey','') <> ''
on conflict (owner_id, goods_key) do nothing;

create or replace function public.sync_shopling_product_group_registry_from_launch_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_goods_key text;
  v_registered_at timestamptz;
  v_ptn_goods_cd text;
begin
  for r in
    select
      e.key as channel_key,
      e.value as product,
      m.group_label,
      m.search_prefix
    from jsonb_each(coalesce(new.item_payload->'shoplingProducts','{}'::jsonb)) e
    join (
      values
        ('wholesale1','도매1','DM1_'),
        ('wholesale2','도매2','DM2_'),
        ('wholesale3','도매3','DM3_'),
        ('wholesale4','도매4','DM4_'),
        ('retail1','소매1','SM1_'),
        ('retail2','소매2','SM2_')
    ) as m(channel_key, group_label, search_prefix)
      on m.channel_key = e.key
  loop
    v_goods_key := coalesce(r.product->>'goodsKey','');
    if v_goods_key = '' then
      continue;
    end if;

    v_registered_at := null;
    if coalesce(r.product->>'registeredAt','') ~ '^\d{4}-\d{2}-\d{2}T' then
      begin
        v_registered_at := (r.product->>'registeredAt')::timestamptz;
      exception when others then
        v_registered_at := null;
      end;
    end if;

    v_ptn_goods_cd := r.search_prefix || coalesce(new.self_code_base,'');

    insert into public.shopling_product_group_registry (
      owner_id,
      goods_key,
      launch_item_id,
      model_number,
      product_group_key,
      product_group_label,
      ptn_goods_cd,
      search_prefix,
      code_format,
      shopling_status,
      registered_at,
      first_seen_at,
      updated_at
    ) values (
      new.owner_id,
      v_goods_key,
      new.item_id,
      coalesce(new.model_number,''),
      r.channel_key,
      r.group_label,
      v_ptn_goods_cd,
      r.search_prefix,
      'group_prefix',
      coalesce(r.product->>'status',''),
      v_registered_at,
      now(),
      now()
    )
    on conflict (owner_id, goods_key) do update set
      launch_item_id = excluded.launch_item_id,
      model_number = excluded.model_number,
      product_group_key = excluded.product_group_key,
      product_group_label = excluded.product_group_label,
      search_prefix = excluded.search_prefix,
      shopling_status = excluded.shopling_status,
      registered_at = coalesce(excluded.registered_at, public.shopling_product_group_registry.registered_at),
      updated_at = now();
  end loop;

  return new;
end;
$$;

revoke all on function public.sync_shopling_product_group_registry_from_launch_item() from public, anon, authenticated;
grant execute on function public.sync_shopling_product_group_registry_from_launch_item() to service_role;

drop trigger if exists product_launch_items_sync_shopling_group_registry on public.product_launch_items;
create trigger product_launch_items_sync_shopling_group_registry
after insert or update of item_payload, self_code_base, model_number
on public.product_launch_items
for each row execute function public.sync_shopling_product_group_registry_from_launch_item();
