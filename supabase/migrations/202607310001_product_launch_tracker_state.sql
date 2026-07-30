begin;

create table if not exists public.product_launch_tracker_states (
  owner_id uuid primary key,
  owner_email text not null default '',
  schema_version integer not null default 3,
  state_payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.product_launch_tracker_states enable row level security;

comment on table public.product_launch_tracker_states is
  'Server-side source of truth for the 신규 상품 출시 진행관리 workspace.';
comment on column public.product_launch_tracker_states.state_payload is
  'Launch items, order options, Shopling policy and integration state as one versioned JSON payload.';

create index if not exists product_launch_tracker_states_updated_at_idx
  on public.product_launch_tracker_states (updated_at desc);

commit;
