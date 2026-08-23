with legacy_options as (
  select distinct
    s.owner_id,
    item.value->>'id' as item_id,
    coalesce(nullif(opt.value->>'id',''), 'option-' || opt.ordinality::text) as option_id,
    upper(regexp_replace(coalesce(opt.value->>'barcode',''), '\s+', '', 'g')) as bcode
  from public.product_launch_tracker_states s
  cross join lateral jsonb_array_elements(coalesce(s.state_payload->'items','[]'::jsonb)) with ordinality item(value, item_ord)
  cross join lateral jsonb_array_elements(coalesce(item.value->'orderOptions','[]'::jsonb)) with ordinality opt(value, ordinality)
), identities as (
  select distinct
    case
      when bcode <> '' then 'B:' || bcode
      else 'OPTION:' || owner_id::text || ':' || item_id || ':' || option_id
    end as identity_key,
    case when bcode <> '' then 'B_CODE' else 'OPTION' end as identity_kind,
    bcode as primary_b_code
  from legacy_options
), missing as (
  select i.*
  from identities i
  left join public.option_barcode_registry r using(identity_key)
  where r.identity_key is null
  order by i.identity_key
)
insert into public.option_barcode_registry(
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
on conflict(identity_key) do nothing;

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
                    'optionBarcodeNo', r.option_barcode_no,
                    'optionBarcodeIdentityKey', r.identity_key,
                    'optionBarcodeIdentityKind', r.identity_kind
                  ) order by opt.ordinality
                )
                from jsonb_array_elements(item.value->'orderOptions') with ordinality opt(value, ordinality)
                join public.option_barcode_registry r
                  on r.identity_key = case
                    when upper(regexp_replace(coalesce(opt.value->>'barcode',''), '\s+', '', 'g')) <> ''
                      then 'B:' || upper(regexp_replace(coalesce(opt.value->>'barcode',''), '\s+', '', 'g'))
                    else 'OPTION:' || s.owner_id::text || ':' || (item.value->>'id') || ':' || coalesce(nullif(opt.value->>'id',''), 'option-' || opt.ordinality::text)
                  end
              ), '[]'::jsonb),
              true
            )
          else item.value
        end
        order by item.ordinality
      )
      from jsonb_array_elements(coalesce(s.state_payload->'items','[]'::jsonb)) with ordinality item(value, ordinality)
    ), '[]'::jsonb),
    true
  ),
  updated_at = now();
