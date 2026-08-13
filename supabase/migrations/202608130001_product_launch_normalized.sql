begin;

create table if not exists public.product_launch_workspaces (
  owner_id uuid primary key,
  owner_email text not null default '',
  schema_version integer not null default 3,
  policy jsonb not null default '{}'::jsonb,
  source_imported_at text,
  counts jsonb not null default '{}'::jsonb,
  filter_options jsonb not null default '{"batches":[],"assignees":[]}'::jsonb,
  meta_payload jsonb not null default '{}'::jsonb,
  source_state_updated_at timestamptz,
  normalized_read_enabled boolean not null default false,
  backfilled_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.product_launch_items (
  owner_id uuid not null,
  item_id text not null,
  tracker_row_number integer,
  work_batch text not null default '',
  warehouse_location text not null default '',
  barcode text not null default '',
  model_number text not null default '',
  product_name text not null default '',
  shopling_category text not null default '',
  self_code_base text not null default '',
  overall_status text not null default '미시작',
  next_stage text not null default '',
  completed_stage_count integer not null default 0,
  readiness_ready boolean not null default false,
  readiness_error_count integer not null default 0,
  readiness_warning_count integer not null default 0,
  detail_page_status text not null default '미시작',
  price_keyword_status text not null default '미시작',
  shopling_upload_status text not null default '미시작',
  market_registration_status text not null default '미시작',
  order_mapping_status text not null default '미시작',
  inventory_reflection_status text not null default '미시작',
  assignees text[] not null default '{}'::text[],
  option_labels text[] not null default '{}'::text[],
  option_barcodes text[] not null default '{}'::text[],
  option_sort_text text not null default '',
  search_text text not null default '',
  archived_at timestamptz,
  migration_review boolean not null default false,
  summary_payload jsonb not null default '{}'::jsonb,
  item_payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text not null default '',
  created_at timestamptz not null default now(),
  primary key (owner_id, item_id),
  foreign key (owner_id) references public.product_launch_workspaces(owner_id) on delete cascade
);

create table if not exists public.product_launch_options (
  owner_id uuid not null,
  item_id text not null,
  option_id text not null,
  option_index integer not null default 0,
  option_name text not null default '옵션',
  sale_option text not null default '',
  china_option text not null default '',
  barcode text not null default '',
  base_sale_price_krw bigint not null default 0,
  unit_cost_krw bigint not null default 0,
  source_order_item_id text,
  option_payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, item_id, option_id),
  foreign key (owner_id, item_id) references public.product_launch_items(owner_id, item_id) on delete cascade
);

alter table public.product_launch_workspaces enable row level security;
alter table public.product_launch_items enable row level security;
alter table public.product_launch_options enable row level security;

create index if not exists product_launch_items_owner_updated_idx on public.product_launch_items (owner_id, updated_at desc);
create index if not exists product_launch_items_owner_model_idx on public.product_launch_items (owner_id, model_number);
create index if not exists product_launch_items_owner_barcode_idx on public.product_launch_items (owner_id, barcode);
create index if not exists product_launch_items_owner_batch_idx on public.product_launch_items (owner_id, work_batch);
create index if not exists product_launch_items_owner_overall_idx on public.product_launch_items (owner_id, overall_status);
create index if not exists product_launch_options_owner_item_idx on public.product_launch_options (owner_id, item_id, option_index);
create index if not exists product_launch_options_owner_barcode_idx on public.product_launch_options (owner_id, barcode);

-- Initial backfill. Legacy JSON remains untouched and remains the rollback source.
insert into public.product_launch_workspaces (
  owner_id, owner_email, schema_version, policy, source_imported_at,
  source_state_updated_at, normalized_read_enabled, backfilled_at, updated_at
)
select
  owner_id,
  owner_email,
  schema_version,
  coalesce(state_payload->'policy', '{}'::jsonb),
  nullif(state_payload->>'sourceImportedAt', ''),
  updated_at,
  false,
  now(),
  now()
from public.product_launch_tracker_states
on conflict (owner_id) do update set
  owner_email = excluded.owner_email,
  schema_version = excluded.schema_version,
  policy = excluded.policy,
  source_imported_at = excluded.source_imported_at,
  source_state_updated_at = excluded.source_state_updated_at,
  backfilled_at = now(),
  updated_at = now();

delete from public.product_launch_options;
delete from public.product_launch_items;

insert into public.product_launch_items (
  owner_id, item_id, tracker_row_number, work_batch, warehouse_location,
  barcode, model_number, product_name, shopling_category, self_code_base,
  overall_status, next_stage, completed_stage_count,
  readiness_ready, readiness_error_count, readiness_warning_count,
  detail_page_status, price_keyword_status, shopling_upload_status,
  market_registration_status, order_mapping_status, inventory_reflection_status,
  assignees, option_labels, option_barcodes, option_sort_text, search_text,
  archived_at, migration_review, summary_payload, item_payload,
  updated_at, updated_by, created_at
)
select
  state.owner_id,
  item.value->>'id',
  coalesce((summary.value->>'trackerRowNumber')::integer, item.ordinality::integer),
  coalesce(item.value->>'workBatch', ''),
  coalesce(item.value->>'warehouseLocation', ''),
  upper(regexp_replace(coalesce(item.value->>'barcode', ''), '\s+', '', 'g')),
  upper(regexp_replace(coalesce(item.value->>'modelNumber', ''), '\s+', '', 'g')),
  coalesce(item.value->>'productName', ''),
  coalesce(item.value->>'shoplingCategory', ''),
  coalesce(item.value->>'selfCodeBase', ''),
  coalesce(summary.value->>'overallStatus', '미시작'),
  coalesce(summary.value->>'nextStage', ''),
  coalesce((summary.value#>>'{progress,completed}')::integer, 0),
  coalesce((summary.value#>>'{readiness,ready}')::boolean, false),
  coalesce((summary.value#>>'{readiness,errorCount}')::integer, 0),
  coalesce((summary.value#>>'{readiness,warningCount}')::integer, 0),
  coalesce(item.value#>>'{stages,detailPage,status}', '미시작'),
  coalesce(item.value#>>'{stages,priceKeyword,status}', '미시작'),
  coalesce(item.value#>>'{stages,shoplingUpload,status}', '미시작'),
  coalesce(item.value#>>'{stages,marketRegistration,status}', '미시작'),
  coalesce(item.value#>>'{stages,orderMapping,status}', '미시작'),
  coalesce(item.value#>>'{stages,inventoryReflection,status}', '미시작'),
  array(
    select distinct stage.value->>'assignee'
    from jsonb_each(coalesce(item.value->'stages', '{}'::jsonb)) stage
    where coalesce(stage.value->>'assignee', '') <> ''
  ),
  array(
    select option.value->>'saleOption'
    from jsonb_array_elements(coalesce(item.value->'orderOptions', '[]'::jsonb)) option(value)
    where coalesce(option.value->>'saleOption', '') <> ''
  ),
  array(
    select upper(regexp_replace(option.value->>'barcode', '\s+', '', 'g'))
    from jsonb_array_elements(coalesce(item.value->'orderOptions', '[]'::jsonb)) option(value)
    where coalesce(option.value->>'barcode', '') <> ''
  ),
  coalesce(
    (select string_agg(option.value->>'saleOption', ', ' order by option.ordinality)
     from jsonb_array_elements(coalesce(item.value->'orderOptions', '[]'::jsonb)) with ordinality option(value, ordinality)),
    ''
  ),
  lower(coalesce(summary.value->>'searchText', concat_ws(' ', item.value->>'workBatch', item.value->>'barcode', item.value->>'modelNumber', item.value->>'productName', item.value->>'shoplingCategory'))),
  nullif(item.value->>'archivedAt', '')::timestamptz,
  coalesce((item.value->>'migrationReview')::boolean, false),
  coalesce(summary.value, '{}'::jsonb) - 'searchText',
  item.value - 'orderOptions' - 'options',
  coalesce(nullif(item.value->>'updatedAt', '')::timestamptz, state.updated_at),
  coalesce(item.value->>'updatedBy', ''),
  coalesce(nullif(item.value->>'createdAt', '')::timestamptz, state.created_at)
from public.product_launch_tracker_states state
cross join lateral jsonb_array_elements(coalesce(state.state_payload->'items', '[]'::jsonb)) with ordinality item(value, ordinality)
left join lateral (
  select candidate.value
  from jsonb_array_elements(coalesce(state.state_payload#>'{productLaunchListSnapshot,summaries}', '[]'::jsonb)) candidate(value)
  where candidate.value->>'id' = item.value->>'id'
  limit 1
) summary on true
where coalesce(item.value->>'id', '') <> '';

insert into public.product_launch_options (
  owner_id, item_id, option_id, option_index, option_name, sale_option,
  china_option, barcode, base_sale_price_krw, unit_cost_krw,
  source_order_item_id, option_payload, updated_at
)
select
  state.owner_id,
  item.value->>'id',
  coalesce(nullif(option.value->>'id', ''), 'option-' || option.ordinality::text),
  option.ordinality::integer - 1,
  coalesce(nullif(option.value->>'optionName', ''), '옵션'),
  coalesce(option.value->>'saleOption', option.value->>'value', ''),
  coalesce(option.value->>'chinaOption', ''),
  upper(regexp_replace(coalesce(option.value->>'barcode', ''), '\s+', '', 'g')),
  greatest(coalesce((option.value->>'baseSalePriceKrw')::bigint, 0), 0),
  greatest(coalesce((option.value->>'unitCostKrw')::bigint, 0), 0),
  nullif(option.value->>'sourceOrderItemId', ''),
  option.value,
  coalesce(nullif(item.value->>'updatedAt', '')::timestamptz, state.updated_at)
from public.product_launch_tracker_states state
cross join lateral jsonb_array_elements(coalesce(state.state_payload->'items', '[]'::jsonb)) item(value)
cross join lateral jsonb_array_elements(coalesce(item.value->'orderOptions', '[]'::jsonb)) with ordinality option(value, ordinality)
where coalesce(item.value->>'id', '') <> '';

update public.product_launch_workspaces workspace
set
  counts = jsonb_build_object(
    '전체', aggregate.active_count,
    '등록 준비', aggregate.ready_count,
    '진행 중', aggregate.in_progress_count,
    '보류', aggregate.hold_count,
    '완료', aggregate.complete_count
  ),
  filter_options = jsonb_build_object(
    'batches', coalesce(aggregate.batches, '[]'::jsonb),
    'assignees', coalesce(aggregate.assignees, '[]'::jsonb)
  ),
  updated_at = now()
from (
  select
    owner_id,
    count(*) filter (where archived_at is null) as active_count,
    count(*) filter (where archived_at is null and readiness_ready) as ready_count,
    count(*) filter (where archived_at is null and overall_status = '진행 중') as in_progress_count,
    count(*) filter (where archived_at is null and overall_status = '보류') as hold_count,
    count(*) filter (where archived_at is null and overall_status = '완료') as complete_count,
    (select jsonb_agg(value order by value) from (select distinct work_batch as value from public.product_launch_items i2 where i2.owner_id = i.owner_id and work_batch <> '') b) as batches,
    (select jsonb_agg(value order by value) from (select distinct unnest(assignees) as value from public.product_launch_items i3 where i3.owner_id = i.owner_id) a) as assignees
  from public.product_launch_items i
  group by owner_id
) aggregate
where workspace.owner_id = aggregate.owner_id;

commit;
