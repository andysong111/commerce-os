with channel_map(channel_key, group_label, search_prefix) as (
  values
    ('wholesale1','도매1','DM1_'),
    ('wholesale2','도매2','DM2_'),
    ('wholesale3','도매3','DM3_'),
    ('wholesale4','도매4','DM4_'),
    ('retail1','소매1','SM1_'),
    ('retail2','소매2','SM2_')
), job_rows as (
  select
    j.owner_id,
    j.launch_item_id,
    coalesce(j.payload->>'modelNumber', p.model_number, '') as model_number,
    r->>'goods_key' as goods_key,
    r->>'channel_key' as channel_key,
    coalesce(r->>'ptn_goods_cd','') as ptn_goods_cd,
    coalesce(r->>'status','') as shopling_status,
    j.completed_at,
    row_number() over (
      partition by j.owner_id, r->>'goods_key'
      order by j.completed_at desc nulls last, j.created_at desc
    ) as rn
  from public.product_launch_upload_jobs j
  cross join lateral jsonb_array_elements(coalesce(j.result->'rows','[]'::jsonb)) r
  left join public.product_launch_items p
    on p.owner_id = j.owner_id and p.item_id = j.launch_item_id
  where j.status = 'success'
    and coalesce(r->>'goods_key','') <> ''
    and coalesce(r->>'channel_key','') <> ''
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
  jr.owner_id,
  jr.goods_key,
  jr.launch_item_id,
  jr.model_number,
  jr.channel_key,
  cm.group_label,
  jr.ptn_goods_cd,
  cm.search_prefix,
  case when jr.ptn_goods_cd like cm.search_prefix || '%' then 'group_prefix' else 'legacy_suffix' end,
  jr.shopling_status,
  jr.completed_at,
  coalesce(jr.completed_at, now()),
  now()
from job_rows jr
join channel_map cm on cm.channel_key = jr.channel_key
where jr.rn = 1
on conflict (owner_id, goods_key) do update set
  launch_item_id = excluded.launch_item_id,
  model_number = case when excluded.model_number <> '' then excluded.model_number else public.shopling_product_group_registry.model_number end,
  product_group_key = excluded.product_group_key,
  product_group_label = excluded.product_group_label,
  ptn_goods_cd = case when excluded.ptn_goods_cd <> '' then excluded.ptn_goods_cd else public.shopling_product_group_registry.ptn_goods_cd end,
  search_prefix = excluded.search_prefix,
  code_format = excluded.code_format,
  shopling_status = excluded.shopling_status,
  registered_at = coalesce(excluded.registered_at, public.shopling_product_group_registry.registered_at),
  updated_at = now();
