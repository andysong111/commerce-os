create sequence if not exists public.option_barcode_no_seq start with 1 increment by 1;

create table if not exists public.option_barcode_registry (
  identity_key text primary key,
  option_barcode_no text not null unique,
  identity_kind text not null default 'B_CODE' check (identity_kind in ('B_CODE','OPTION','SET')),
  primary_b_code text not null default '',
  composition jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (option_barcode_no ~ '^OB[0-9]{12}$')
);

comment on table public.option_barcode_registry is
  'Permanent Commerce OS option barcode identity ledger. Same B-code shares one option barcode NO; SET identities represent canonical bundle compositions.';
comment on column public.option_barcode_registry.identity_key is
  'B:<normalized B-code>, OPTION:<owner:item:option> provisional identity, or SET:<canonical composition fingerprint>.';
comment on column public.option_barcode_registry.option_barcode_no is
  'Internal Shopling option barcode NO. This is not a GS1/EAN code.';

alter table public.option_barcode_registry enable row level security;
revoke all on table public.option_barcode_registry from anon, authenticated;
grant select, insert, update on table public.option_barcode_registry to service_role;
revoke all on sequence public.option_barcode_no_seq from anon, authenticated;
grant usage, select on sequence public.option_barcode_no_seq to service_role;

alter table public.product_launch_options
  add column if not exists option_barcode_no text not null default '',
  add column if not exists option_barcode_identity_key text not null default '';

alter table public.product_launch_items
  add column if not exists option_barcode_nos text[] not null default '{}'::text[];

create index if not exists product_launch_options_option_barcode_no_idx
  on public.product_launch_options (option_barcode_no)
  where option_barcode_no <> '';
create index if not exists product_launch_options_identity_key_idx
  on public.product_launch_options (option_barcode_identity_key)
  where option_barcode_identity_key <> '';

create or replace function public.resolve_option_barcode_nos(p_requests jsonb)
returns table(identity_key text, option_barcode_no text)
language plpgsql
security definer
set search_path = public
as $$
declare
  req jsonb;
  v_identity text;
  v_kind text;
  v_bcode text;
  v_composition jsonb;
  v_no text;
begin
  if jsonb_typeof(p_requests) <> 'array' then
    raise exception 'p_requests must be a JSON array';
  end if;

  for req in select value from jsonb_array_elements(p_requests)
  loop
    v_identity := btrim(coalesce(req->>'identityKey', ''));
    v_kind := upper(btrim(coalesce(req->>'identityKind', 'B_CODE')));
    v_bcode := upper(regexp_replace(coalesce(req->>'primaryBCode', ''), '\s+', '', 'g'));
    v_composition := coalesce(req->'composition', '[]'::jsonb);

    if v_identity = '' or v_kind not in ('B_CODE','OPTION','SET') then
      raise exception 'invalid option barcode identity';
    end if;

    select r.option_barcode_no into v_no
      from public.option_barcode_registry r
     where r.identity_key = v_identity;

    if v_no is null then
      v_no := 'OB' || lpad(nextval('public.option_barcode_no_seq')::text, 12, '0');
      insert into public.option_barcode_registry (
        identity_key, option_barcode_no, identity_kind, primary_b_code, composition
      ) values (
        v_identity, v_no, v_kind, v_bcode, v_composition
      )
      on conflict (identity_key) do nothing;

      select r.option_barcode_no into v_no
        from public.option_barcode_registry r
       where r.identity_key = v_identity;
    end if;

    identity_key := v_identity;
    option_barcode_no := v_no;
    return next;
  end loop;
end;
$$;

revoke all on function public.resolve_option_barcode_nos(jsonb) from public, anon, authenticated;
grant execute on function public.resolve_option_barcode_nos(jsonb) to service_role;

-- Existing options receive deterministic identity keys. B-code duplicates intentionally share one row.
with identities as (
  select distinct
    case
      when btrim(o.barcode) <> '' then
        'B:' || upper(regexp_replace(o.barcode, '\s+', '', 'g'))
      else
        'OPTION:' || o.owner_id::text || ':' || o.item_id || ':' || o.option_id
    end as identity_key,
    case when btrim(o.barcode) <> '' then 'B_CODE' else 'OPTION' end as identity_kind,
    case
      when btrim(o.barcode) <> '' then upper(regexp_replace(o.barcode, '\s+', '', 'g'))
      else ''
    end as primary_b_code
  from public.product_launch_options o
), missing as (
  select i.*
  from identities i
  left join public.option_barcode_registry r using (identity_key)
  where r.identity_key is null
  order by i.identity_key
)
insert into public.option_barcode_registry (
  identity_key,
  option_barcode_no,
  identity_kind,
  primary_b_code,
  composition
)
select
  identity_key,
  'OB' || lpad(nextval('public.option_barcode_no_seq')::text, 12, '0'),
  identity_kind,
  primary_b_code,
  '[]'::jsonb
from missing
on conflict (identity_key) do nothing;

with mapping as (
  select
    o.owner_id,
    o.item_id,
    o.option_id,
    case
      when btrim(o.barcode) <> '' then
        'B:' || upper(regexp_replace(o.barcode, '\s+', '', 'g'))
      else
        'OPTION:' || o.owner_id::text || ':' || o.item_id || ':' || o.option_id
    end as identity_key,
    case when btrim(o.barcode) <> '' then 'B_CODE' else 'OPTION' end as identity_kind
  from public.product_launch_options o
)
update public.product_launch_options o
set
  option_barcode_identity_key = m.identity_key,
  option_barcode_no = r.option_barcode_no,
  option_payload = coalesce(o.option_payload, '{}'::jsonb) || jsonb_build_object(
    'optionBarcodeNo', r.option_barcode_no,
    'optionBarcodeIdentityKey', m.identity_key,
    'optionBarcodeIdentityKind', m.identity_kind
  ),
  updated_at = now()
from mapping m
join public.option_barcode_registry r on r.identity_key = m.identity_key
where m.owner_id = o.owner_id
  and m.item_id = o.item_id
  and m.option_id = o.option_id;

update public.product_launch_items i
set
  option_barcode_nos = coalesce(x.nos, '{}'::text[]),
  updated_at = now()
from (
  select
    owner_id,
    item_id,
    array_agg(option_barcode_no order by option_index)
      filter (where option_barcode_no <> '') as nos
  from public.product_launch_options
  group by owner_id, item_id
) x
where x.owner_id = i.owner_id
  and x.item_id = i.item_id;

-- Keep the legacy JSON authority in sync so existing detail screens receive the identities immediately.
update public.product_launch_tracker_states s
set
  state_payload = jsonb_set(
    s.state_payload,
    '{items}',
    coalesce((
      select jsonb_agg(
        case
          when jsonb_typeof(item.value->'orderOptions') = 'array' then
            jsonb_set(
              item.value,
              '{orderOptions}',
              coalesce((
                select jsonb_agg(
                  opt.value || jsonb_build_object(
                    'optionBarcodeNo', coalesce(po.option_barcode_no, ''),
                    'optionBarcodeIdentityKey', coalesce(po.option_barcode_identity_key, ''),
                    'optionBarcodeIdentityKind', case
                      when coalesce(po.option_barcode_identity_key, '') like 'B:%' then 'B_CODE'
                      when coalesce(po.option_barcode_identity_key, '') like 'SET:%' then 'SET'
                      else 'OPTION'
                    end
                  )
                  order by opt.ordinality
                )
                from jsonb_array_elements(item.value->'orderOptions')
                  with ordinality opt(value, ordinality)
                left join public.product_launch_options po
                  on po.owner_id = s.owner_id
                 and po.item_id = item.value->>'id'
                 and po.option_id = coalesce(
                   nullif(opt.value->>'id', ''),
                   'option-' || opt.ordinality::text
                 )
              ), '[]'::jsonb),
              true
            )
          else item.value
        end
        order by item.ordinality
      )
      from jsonb_array_elements(coalesce(s.state_payload->'items', '[]'::jsonb))
        with ordinality item(value, ordinality)
    ), '[]'::jsonb),
    true
  ),
  updated_at = now();
