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

insert into public.commerce_data_source_health(
  source_key,status,generated_at,received_at,max_age_minutes,details,updated_at
) values
  ('sales_orders','MISSING',null,now(),1440,'{"requiredFor":["purchase_plan","price_decrease","discontinue_review"]}'::jsonb,now()),
  ('confirmed_receipts','MISSING',null,now(),5,'{"requiredFor":["price_analysis"]}'::jsonb,now()),
  ('product_mappings','MISSING',null,now(),1440,'{"requiredFor":["shopling_price_execution"]}'::jsonb,now()),
  ('estimated_inventory','MISSING',null,now(),1440,'{"requiredFor":["purchase_plan"]}'::jsonb,now()),
  ('price_recommendations','MISSING',null,now(),1440,'{"requiredFor":["shopling_price_execution"]}'::jsonb,now())
on conflict (source_key) do nothing;

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

create or replace function public.audit_shopling_price_adjustment_job_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    insert into public.commerce_audit_logs(
      operation_run_id,
      correlation_id,
      actor_type,
      actor_id,
      action,
      entity_type,
      entity_id,
      before_snapshot,
      after_snapshot,
      metadata,
      occurred_at
    ) values (
      null,
      new.id::text,
      'OPS_OPERATOR',
      new.owner_id::text,
      'shopling_price_adjustment.status_changed',
      'shopling_price_adjustment_bulk_job',
      new.id::text,
      jsonb_build_object(
        'status', old.status,
        'lastError', old.last_error,
        'updatedAt', old.updated_at
      ),
      jsonb_build_object(
        'status', new.status,
        'lastError', new.last_error,
        'updatedAt', new.updated_at,
        'completedAt', new.completed_at
      ),
      jsonb_build_object(
        'validCount', new.valid_count,
        'canarySize', new.canary_size,
        'chunkSize', new.chunk_size
      ),
      now()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists audit_shopling_price_adjustment_job_status
  on public.shopling_price_adjustment_bulk_jobs;
create trigger audit_shopling_price_adjustment_job_status
after update of status on public.shopling_price_adjustment_bulk_jobs
for each row execute function public.audit_shopling_price_adjustment_job_status();

alter table public.commerce_operation_runs enable row level security;
alter table public.commerce_processed_events enable row level security;
alter table public.commerce_audit_logs enable row level security;
alter table public.commerce_data_source_health enable row level security;

comment on table public.commerce_operation_runs is
  'Cross-service execution ledger. Receipt confirmation creates price analysis only; Shopling writes require separate approval.';
comment on table public.commerce_processed_events is
  'Idempotency ledger for integration events.';
comment on table public.commerce_audit_logs is
  'Immutable audit trail for critical Commerce OS actions and price job transitions.';
comment on table public.commerce_data_source_health is
  'Freshness and failure status for sales, receipts, products, inventory and recommendations.';

commit;
