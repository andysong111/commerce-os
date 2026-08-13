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

commit;
