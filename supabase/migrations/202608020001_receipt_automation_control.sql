begin;

create table if not exists public.commerce_operation_runs (
  id uuid primary key default gen_random_uuid(),
  operation_type text not null,
  status text not null check (
    status in ('PENDING', 'RUNNING', 'AWAITING_APPROVAL', 'SUCCEEDED', 'FAILED', 'CANCELLED')
  ),
  source text not null,
  source_event_id text not null,
  correlation_id text not null,
  actor_type text not null default 'SYSTEM',
  actor_id text,
  input_snapshot jsonb not null default '{}'::jsonb,
  result_snapshot jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists commerce_operation_runs_source_event_uq
  on public.commerce_operation_runs(source_event_id);
create index if not exists commerce_operation_runs_status_started_idx
  on public.commerce_operation_runs(status, started_at desc);
create index if not exists commerce_operation_runs_correlation_idx
  on public.commerce_operation_runs(correlation_id);

create table if not exists public.commerce_processed_events (
  event_id text primary key,
  event_type text not null,
  correlation_id text not null,
  operation_run_id uuid references public.commerce_operation_runs(id) on delete set null,
  result_snapshot jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now()
);

create table if not exists public.commerce_audit_logs (
  id uuid primary key default gen_random_uuid(),
  operation_run_id uuid references public.commerce_operation_runs(id) on delete set null,
  correlation_id text not null,
  actor_type text not null,
  actor_id text,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists commerce_audit_logs_correlation_idx
  on public.commerce_audit_logs(correlation_id, occurred_at desc);
create index if not exists commerce_audit_logs_entity_idx
  on public.commerce_audit_logs(entity_type, entity_id, occurred_at desc);

create table if not exists public.commerce_data_source_health (
  source_key text primary key,
  status text not null check (status in ('FRESH', 'STALE', 'MISSING', 'FAILED')),
  generated_at timestamptz,
  received_at timestamptz not null default now(),
  max_age_minutes integer not null check (max_age_minutes > 0),
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.set_commerce_operation_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists commerce_operation_runs_set_updated_at
  on public.commerce_operation_runs;
create trigger commerce_operation_runs_set_updated_at
before update on public.commerce_operation_runs
for each row execute function public.set_commerce_operation_updated_at();

alter table public.commerce_operation_runs enable row level security;
alter table public.commerce_processed_events enable row level security;
alter table public.commerce_audit_logs enable row level security;
alter table public.commerce_data_source_health enable row level security;

comment on table public.commerce_operation_runs is
  'Cross-service execution ledger. Receipt confirmation creates price analysis only; Shopling writes require separate approval.';
comment on table public.commerce_processed_events is
  'Idempotency ledger for integration events.';
comment on table public.commerce_audit_logs is
  'Immutable audit trail for critical Commerce OS actions.';
comment on table public.commerce_data_source_health is
  'Freshness and failure status for sales, receipts, products, inventory and recommendations.';

commit;
