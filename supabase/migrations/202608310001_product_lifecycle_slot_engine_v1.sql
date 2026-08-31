begin;

create table if not exists public.product_lifecycle_states (
  sku_id text primary key,
  barcode text not null,
  lifecycle_state text not null check (lifecycle_state in ('TEST','EXPAND','MAINTAIN','REDUCE','DORMANT','RETEST','DISCONTINUE')),
  desired_shopling_state text not null check (desired_shopling_state in ('SELLING','SOLD_OUT','DELETE')),
  purchase_policy text not null check (purchase_policy in ('NORMAL','STOP')),
  warehouse_policy text not null check (warehouse_policy in ('KEEP','TRIM','EXIT')),
  shadow_mode boolean not null default true,
  requires_review boolean not null default false,
  review_reason text,
  last_sale_at timestamptz,
  no_sale_days integer check (no_sale_days is null or no_sale_days >= 0),
  sales_quantity_30 numeric not null default 0 check (sales_quantity_30 >= 0),
  sales_quantity_90 numeric not null default 0 check (sales_quantity_90 >= 0),
  sales_quantity_365 numeric not null default 0 check (sales_quantity_365 >= 0),
  sales_trend text not null default 'INSUFFICIENT',
  momentum_ratio numeric,
  inventory_quantity numeric not null default 0,
  inventory_confirmed boolean not null default false,
  next_evaluation_at timestamptz,
  reason_codes jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  source_fingerprint text not null,
  rule_version text not null,
  evaluated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.product_lifecycle_states is
  'Latest Commerce OS product lifecycle/slot decision. Product grade is not a control input. Shadow mode is the default safety boundary.';
comment on column public.product_lifecycle_states.desired_shopling_state is
  'Desired Shopling state produced by lifecycle policy. DELETE is eligible only after the engine verifies destructive-action safety.';
comment on column public.product_lifecycle_states.purchase_policy is
  'Purchase recommendation overlay. STOP blocks reorder only when lifecycle enforcement is live; grade-based price logic is not used.';

create index if not exists product_lifecycle_states_state_idx
  on public.product_lifecycle_states (lifecycle_state, requires_review, evaluated_at desc);
create index if not exists product_lifecycle_states_barcode_idx
  on public.product_lifecycle_states (barcode);
create index if not exists product_lifecycle_states_next_eval_idx
  on public.product_lifecycle_states (next_evaluation_at)
  where next_evaluation_at is not null;

create table if not exists public.product_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  sku_id text not null,
  barcode text not null,
  previous_state text,
  new_state text not null check (new_state in ('TEST','EXPAND','MAINTAIN','REDUCE','DORMANT','RETEST','DISCONTINUE')),
  previous_shopling_state text,
  new_shopling_state text not null check (new_shopling_state in ('SELLING','SOLD_OUT','DELETE')),
  previous_purchase_policy text,
  new_purchase_policy text not null check (new_purchase_policy in ('NORMAL','STOP')),
  previous_warehouse_policy text,
  new_warehouse_policy text not null check (new_warehouse_policy in ('KEEP','TRIM','EXIT')),
  shadow_mode boolean not null default true,
  requires_review boolean not null default false,
  reason_codes jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  source_fingerprint text not null,
  rule_version text not null,
  evaluated_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table public.product_lifecycle_events is
  'Append-only lifecycle transition evidence used for audit, rollback reasoning, and regression analysis.';

create index if not exists product_lifecycle_events_sku_idx
  on public.product_lifecycle_events (sku_id, evaluated_at desc);
create index if not exists product_lifecycle_events_transition_idx
  on public.product_lifecycle_events (new_state, evaluated_at desc);

create table if not exists public.shopling_lifecycle_action_queue (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  sku_id text not null,
  barcode text not null,
  goods_key text not null,
  desired_state text not null check (desired_state in ('SELLING','SOLD_OUT','DELETE')),
  lifecycle_state text not null check (lifecycle_state in ('TEST','EXPAND','MAINTAIN','REDUCE','DORMANT','RETEST','DISCONTINUE')),
  status text not null default 'shadow' check (status in ('shadow','pending','claimed','succeeded','failed','confirm_needed','cancelled')),
  shadow_mode boolean not null default true,
  scheduled_for timestamptz not null default now(),
  claim_run_id text,
  claimed_at timestamptz,
  executed_at timestamptz,
  reason_codes jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.shopling_lifecycle_action_queue is
  'Listing-level Shopling selling/sold-out/delete work queue. Shadow rows are never claimable by the browser executor.';

create index if not exists shopling_lifecycle_action_queue_work_idx
  on public.shopling_lifecycle_action_queue (status, scheduled_for, created_at)
  where status in ('pending','claimed','failed','confirm_needed');
create index if not exists shopling_lifecycle_action_queue_sku_idx
  on public.shopling_lifecycle_action_queue (sku_id, updated_at desc);
create index if not exists shopling_lifecycle_action_queue_goods_idx
  on public.shopling_lifecycle_action_queue (goods_key, updated_at desc);

alter table public.product_lifecycle_states enable row level security;
alter table public.product_lifecycle_events enable row level security;
alter table public.shopling_lifecycle_action_queue enable row level security;

revoke all on table public.product_lifecycle_states from anon, authenticated;
revoke all on table public.product_lifecycle_events from anon, authenticated;
revoke all on table public.shopling_lifecycle_action_queue from anon, authenticated;

insert into public.ops_dispatch_tasks (
  task_key,
  route_path,
  workload_class,
  priority,
  enabled,
  normal_interval_seconds,
  busy_interval_seconds,
  recovery_interval_seconds,
  timeout_seconds,
  next_run_at,
  updated_at
) values (
  'product-lifecycle-refresh',
  '/api/cron/product-lifecycle-refresh',
  'operational',
  115,
  true,
  3600,
  300,
  21600,
  120,
  now(),
  now()
)
on conflict (task_key) do update set
  route_path = excluded.route_path,
  workload_class = excluded.workload_class,
  priority = excluded.priority,
  enabled = true,
  normal_interval_seconds = excluded.normal_interval_seconds,
  busy_interval_seconds = excluded.busy_interval_seconds,
  recovery_interval_seconds = excluded.recovery_interval_seconds,
  timeout_seconds = excluded.timeout_seconds,
  next_run_at = least(public.ops_dispatch_tasks.next_run_at, now()),
  updated_at = now();

update public.ops_dispatch_tasks
set
  enabled = false,
  last_result = jsonb_build_object(
    'retiredAt', now(),
    'reason', 'Product grade shadow bootstrap retired; lifecycle/slot engine is the single product-state control plane.'
  ),
  updated_at = now()
where task_key = 'price-grade-receipt-shadow-bootstrap';

commit;
