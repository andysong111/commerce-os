create table if not exists public.shopling_market_auto_orchestrations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  owner_email text not null default '',
  batch_id text not null default '',
  run_ids jsonb not null default '[]'::jsonb,
  token_hash text not null unique,
  state text not null default 'waiting_upload',
  agent_id text not null default '',
  lease_until timestamptz,
  heartbeat_at timestamptz,
  market_started_at timestamptz,
  completed_at timestamptz,
  error_message text not null default '',
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shopling_market_auto_orchestrations_state_check
    check (state in (
      'waiting_upload',
      'uploading',
      'market_ready',
      'market_claimed',
      'market_running',
      'completed',
      'completed_with_exceptions',
      'exception',
      'cancelled'
    ))
);

create index if not exists shopling_market_auto_orchestrations_owner_created_idx
  on public.shopling_market_auto_orchestrations(owner_id, created_at desc);

create index if not exists shopling_market_auto_orchestrations_state_lease_idx
  on public.shopling_market_auto_orchestrations(state, lease_until);

alter table public.shopling_market_auto_orchestrations enable row level security;
revoke all on table public.shopling_market_auto_orchestrations from anon, authenticated;

comment on table public.shopling_market_auto_orchestrations is
  'Durable one-click bridge from SEO bulk Shopling upload to local Shopling market sender agent.';
