create table if not exists public.product_launch_china_link_audits (
  audit_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  item_id text not null,
  tracker_row_number integer,
  model_number text not null default '',
  product_name text not null default '',
  link_slot smallint not null default 1 check (link_slot between 1 and 5),
  url text not null,
  status text not null check (status in ('ok', 'link_error', 'temporary_error')),
  error_code text not null default '',
  error_message text not null default '',
  final_url text not null default '',
  collector_version text not null default '',
  checked_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, item_id, link_slot)
);

create index if not exists product_launch_china_link_audits_owner_status_idx
  on public.product_launch_china_link_audits (owner_id, status, checked_at desc);
create index if not exists product_launch_china_link_audits_owner_item_idx
  on public.product_launch_china_link_audits (owner_id, item_id);

create or replace function public.touch_product_launch_china_link_audit_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists product_launch_china_link_audits_touch_updated_at
  on public.product_launch_china_link_audits;
create trigger product_launch_china_link_audits_touch_updated_at
before update on public.product_launch_china_link_audits
for each row execute function public.touch_product_launch_china_link_audit_updated_at();

alter table public.product_launch_china_link_audits enable row level security;
revoke all on table public.product_launch_china_link_audits from anon, authenticated;
grant all on table public.product_launch_china_link_audits to service_role;

create or replace view public.product_launch_primary_link_health
with (security_invoker = true)
as
select
  p.owner_id,
  p.item_id,
  p.tracker_row_number,
  p.model_number,
  p.product_name,
  l.link_1 as primary_url,
  l.link_2 as fallback_url,
  l.link_count,
  (l.link_2 <> '') as has_fallback,
  coalesce(a.status, case when l.link_1 = '' then 'missing' else 'unchecked' end) as health_status,
  coalesce(a.error_code, '') as error_code,
  coalesce(a.error_message, '') as error_message,
  coalesce(a.final_url, '') as final_url,
  coalesce(a.collector_version, '') as collector_version,
  a.checked_at,
  p.updated_at as item_updated_at
from public.product_launch_items p
cross join lateral (
  select
    coalesce(
      nullif(btrim(p.item_payload->>'primaryChinaProductLink'), ''),
      nullif(btrim(p.item_payload#>>'{detailPageSource,primaryUrl}'), ''),
      nullif(btrim(p.item_payload#>>'{chinaProductLinks,0}'), ''),
      nullif(btrim(p.item_payload#>>'{detailPageSource,urls,0}'), ''),
      ''
    ) as link_1,
    coalesce(
      nullif(btrim(p.item_payload#>>'{chinaProductLinks,1}'), ''),
      nullif(btrim(p.item_payload#>>'{detailPageSource,urls,1}'), ''),
      ''
    ) as link_2,
    (
      select count(*)::integer
      from unnest(array[
        coalesce(nullif(btrim(p.item_payload#>>'{chinaProductLinks,0}'), ''), nullif(btrim(p.item_payload#>>'{detailPageSource,urls,0}'), ''), ''),
        coalesce(nullif(btrim(p.item_payload#>>'{chinaProductLinks,1}'), ''), nullif(btrim(p.item_payload#>>'{detailPageSource,urls,1}'), ''), ''),
        coalesce(nullif(btrim(p.item_payload#>>'{chinaProductLinks,2}'), ''), nullif(btrim(p.item_payload#>>'{detailPageSource,urls,2}'), ''), ''),
        coalesce(nullif(btrim(p.item_payload#>>'{chinaProductLinks,3}'), ''), nullif(btrim(p.item_payload#>>'{detailPageSource,urls,3}'), ''), ''),
        coalesce(nullif(btrim(p.item_payload#>>'{chinaProductLinks,4}'), ''), nullif(btrim(p.item_payload#>>'{detailPageSource,urls,4}'), ''), '')
      ]) as candidate(url)
      where candidate.url <> ''
    ) as link_count
) l
left join public.product_launch_china_link_audits a
  on a.owner_id = p.owner_id
 and a.item_id = p.item_id
 and a.link_slot = 1
 and a.url = l.link_1
where p.archived_at is null;

revoke all on table public.product_launch_primary_link_health from anon, authenticated;
grant select on table public.product_launch_primary_link_health to service_role;
