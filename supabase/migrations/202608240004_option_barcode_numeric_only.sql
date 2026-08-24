-- Commerce OS option barcode NOs become numeric-only while preserving the permanent identity mapping.
-- Existing OB000000000001 -> 000000000001. B-code and SET identity keys do not change.

alter table public.option_barcode_registry
  drop constraint if exists option_barcode_registry_option_barcode_no_check;

update public.option_barcode_registry
set
  option_barcode_no = regexp_replace(option_barcode_no, '^OB', ''),
  updated_at = now()
where option_barcode_no ~ '^OB[0-9]{12}$';

alter table public.option_barcode_registry
  add constraint option_barcode_registry_option_barcode_no_check
  check (option_barcode_no ~ '^[0-9]{12}$');

comment on column public.option_barcode_registry.option_barcode_no is
  'Permanent Commerce OS numeric-only 12 digit option barcode NO. This is an internal identifier, not a GS1/EAN assignment.';

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

-- Normalized option rows and their JSON mirrors.
update public.product_launch_options
set
  option_barcode_no = regexp_replace(option_barcode_no, '^OB', ''),
  option_payload = case
    when jsonb_typeof(coalesce(option_payload, '{}'::jsonb)) = 'object'
      then jsonb_set(
        coalesce(option_payload, '{}'::jsonb),
        '{optionBarcodeNo}',
        to_jsonb(regexp_replace(coalesce(option_payload->>'optionBarcodeNo', option_barcode_no), '^OB', '')),
        true
      )
    else option_payload
  end,
  updated_at = now()
where option_barcode_no ~ '^OB[0-9]{12}$'
   or coalesce(option_payload->>'optionBarcodeNo', '') ~ '^OB[0-9]{12}$';

-- Item-level numeric option barcode arrays.
update public.product_launch_items i
set
  option_barcode_nos = coalesce((
    select array_agg(regexp_replace(value, '^OB', '') order by ordinality)
    from unnest(i.option_barcode_nos) with ordinality x(value, ordinality)
  ), '{}'::text[]),
  updated_at = now()
where exists (
  select 1 from unnest(i.option_barcode_nos) value where value ~ '^OB[0-9]{12}$'
);

-- Legacy JSON authority used by the current tracker UI.
update public.product_launch_tracker_states s
set
  state_payload = jsonb_set(
    s.state_payload,
    '{items}',
    coalesce((
      select jsonb_agg(
        case
          when jsonb_typeof(item.value) = 'object' then
            (
              case
                when jsonb_typeof(item.value->'orderOptions') = 'array' then
                  jsonb_set(
                    item.value,
                    '{orderOptions}',
                    coalesce((
                      select jsonb_agg(
                        case
                          when coalesce(opt.value->>'optionBarcodeNo', '') ~ '^OB[0-9]{12}$' then
                            jsonb_set(
                              opt.value,
                              '{optionBarcodeNo}',
                              to_jsonb(regexp_replace(opt.value->>'optionBarcodeNo', '^OB', '')),
                              true
                            )
                          else opt.value
                        end
                        order by opt.ordinality
                      )
                      from jsonb_array_elements(item.value->'orderOptions')
                        with ordinality opt(value, ordinality)
                    ), '[]'::jsonb),
                    true
                  )
                else item.value
              end
            )
            ||
            case
              when jsonb_typeof(item.value->'optionBarcodeNos') = 'array' then
                jsonb_build_object(
                  'optionBarcodeNos',
                  coalesce((
                    select jsonb_agg(
                      to_jsonb(regexp_replace(trim(both '"' from no.value::text), '^OB', ''))
                      order by no.ordinality
                    )
                    from jsonb_array_elements(item.value->'optionBarcodeNos')
                      with ordinality no(value, ordinality)
                  ), '[]'::jsonb)
                )
              else '{}'::jsonb
            end
          else item.value
        end
        order by item.ordinality
      )
      from jsonb_array_elements(coalesce(s.state_payload->'items', '[]'::jsonb))
        with ordinality item(value, ordinality)
    ), '[]'::jsonb),
    true
  ),
  updated_at = now()
where s.state_payload::text like '%OB%';
