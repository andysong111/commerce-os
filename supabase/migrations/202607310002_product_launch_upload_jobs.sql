begin;

create table if not exists public.product_launch_upload_jobs (
  id uuid primary key,
  owner_id uuid not null,
  owner_email text not null default '',
  launch_item_id text not null,
  request_id text not null unique,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'success', 'partial_failure', 'failed')),
  payload jsonb not null,
  result jsonb,
  error_message text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.product_launch_upload_jobs enable row level security;

create index if not exists product_launch_upload_jobs_owner_created_idx
  on public.product_launch_upload_jobs (owner_id, created_at desc);
create index if not exists product_launch_upload_jobs_item_created_idx
  on public.product_launch_upload_jobs (launch_item_id, created_at desc);

comment on table public.product_launch_upload_jobs is
  'Validated Shopling registration jobs created from product launch tracker items.';

commit;
