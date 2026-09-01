create table if not exists public.product_lifecycle_runtime_config (
  config_key text primary key,
  shopling_non_destructive_live boolean not null default false,
  purchase_stop_live boolean not null default false,
  delete_live boolean not null default false,
  note text not null default '',
  updated_at timestamptz not null default now(),
  constraint product_lifecycle_runtime_config_singleton check (config_key = 'default')
);

insert into public.product_lifecycle_runtime_config (
  config_key,
  shopling_non_destructive_live,
  purchase_stop_live,
  delete_live,
  note
)
values (
  'default',
  false,
  false,
  false,
  'Fail-closed defaults. Enable non-destructive Shopling B<->C and purchase STOP independently after canary validation. DELETE stays separately locked.'
)
on conflict (config_key) do nothing;

alter table public.product_lifecycle_runtime_config enable row level security;
revoke all on table public.product_lifecycle_runtime_config from anon, authenticated;

comment on table public.product_lifecycle_runtime_config is
  'Server-only runtime gates for product lifecycle enforcement. DELETE must remain independently gated.';
comment on column public.product_lifecycle_runtime_config.shopling_non_destructive_live is
  'Allows only field-tested Shopling SELLING(B) <-> SOLD_OUT(C) reconciliation.';
comment on column public.product_lifecycle_runtime_config.purchase_stop_live is
  'Allows lifecycle STOP policy to zero purchase recommendations without changing lifecycle state shadow_mode.';
comment on column public.product_lifecycle_runtime_config.delete_live is
  'Reserved destructive gate. Runtime reconciliation does not execute DELETE even when true.';
