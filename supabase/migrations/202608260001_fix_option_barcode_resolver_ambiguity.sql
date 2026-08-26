-- Fix PL/pgSQL output-column ambiguity in resolve_option_barcode_nos.
-- `identity_key` is also a RETURNS TABLE output variable, so ON CONFLICT (identity_key)
-- can be interpreted ambiguously by PostgreSQL. Target the primary-key constraint explicitly.

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
      v_no := lpad(nextval('public.option_barcode_no_seq')::text, 12, '0');
      insert into public.option_barcode_registry (
        identity_key,
        option_barcode_no,
        identity_kind,
        primary_b_code,
        composition
      ) values (
        v_identity,
        v_no,
        v_kind,
        v_bcode,
        v_composition
      )
      on conflict on constraint option_barcode_registry_pkey do nothing;

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

-- Repair stale normalized options that gained a B-code after their provisional OPTION identity
-- was created, or were left blank while the resolver was failing.
with canonical_b_codes as (
  select distinct
    'B:' || upper(regexp_replace(o.barcode, '\s+', '', 'g')) as identity_key,
    upper(regexp_replace(o.barcode, '\s+', '', 'g')) as primary_b_code
  from public.product_launch_options o
  where btrim(o.barcode) <> ''
), missing as (
  select c.*
  from canonical_b_codes c
  left join public.option_barcode_registry r on r.identity_key = c.identity_key
  where r.identity_key is null
  order by c.identity_key
)
insert into public.option_barcode_registry (
  identity_key,
  option_barcode_no,
  identity_kind,
  primary_b_code,
  composition
)
select
  m.identity_key,
  lpad(nextval('public.option_barcode_no_seq')::text, 12, '0'),
  'B_CODE',
  m.primary_b_code,
  '[]'::jsonb
from missing m
on conflict on constraint option_barcode_registry_pkey do nothing;

with mapping as (
  select
    o.owner_id,
    o.item_id,
    o.option_id,
    'B:' || upper(regexp_replace(o.barcode, '\s+', '', 'g')) as identity_key
  from public.product_launch_options o
  where btrim(o.barcode) <> ''
)
update public.product_launch_options o
set
  option_barcode_identity_key = m.identity_key,
  option_barcode_no = r.option_barcode_no,
  option_payload = coalesce(o.option_payload, '{}'::jsonb) || jsonb_build_object(
    'optionBarcodeNo', r.option_barcode_no,
    'optionBarcodeIdentityKey', m.identity_key,
    'optionBarcodeIdentityKind', 'B_CODE'
  ),
  updated_at = now()
from mapping m
join public.option_barcode_registry r on r.identity_key = m.identity_key
where m.owner_id = o.owner_id
  and m.item_id = o.item_id
  and m.option_id = o.option_id
  and (
    o.option_barcode_no is distinct from r.option_barcode_no
    or o.option_barcode_identity_key is distinct from m.identity_key
  );

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
  and x.item_id = i.item_id
  and i.option_barcode_nos is distinct from coalesce(x.nos, '{}'::text[]);

-- Keep the legacy JSON authority in sync because the Shopling uploader still builds its payload
-- from this state. This makes existing stale items immediately retryable without manual edits.
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
                    'optionBarcodeNo', coalesce(po.option_barcode_no, opt.value->>'optionBarcodeNo', ''),
                    'optionBarcodeIdentityKey', coalesce(po.option_barcode_identity_key, opt.value->>'optionBarcodeIdentityKey', ''),
                    'optionBarcodeIdentityKind', case
                      when coalesce(po.option_barcode_identity_key, opt.value->>'optionBarcodeIdentityKey', '') like 'B:%' then 'B_CODE'
                      when coalesce(po.option_barcode_identity_key, opt.value->>'optionBarcodeIdentityKey', '') like 'SET:%' then 'SET'
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
