create table if not exists public.freight_barcode_history (
  id text primary key,
  application_no text not null default '',
  title text not null default '',
  raw_text text not null default '',
  parsed_items jsonb not null default '[]'::jsonb,
  product_master_matches jsonb not null default '[]'::jsonb,
  memo text not null default '',
  source text not null default 'manual-paste',
  pdf_version integer not null default 1,
  item_count integer not null default 0,
  matched_item_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint freight_barcode_history_source_check
    check (source in ('manual-paste', 'restored-history')),
  constraint freight_barcode_history_item_count_check
    check (item_count >= 0),
  constraint freight_barcode_history_matched_item_count_check
    check (matched_item_count >= 0)
);

create index if not exists freight_barcode_history_updated_at_idx
  on public.freight_barcode_history (updated_at desc);

create index if not exists freight_barcode_history_application_no_idx
  on public.freight_barcode_history (application_no);

alter table public.freight_barcode_history enable row level security;

grant select, insert, update, delete
  on table public.freight_barcode_history
  to service_role;

comment on table public.freight_barcode_history is
  'Persistent snapshots for Commerce OS freight barcode work requests and generated document history.';
