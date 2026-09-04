create or replace function public.resolve_option_barcode_nos(p_requests jsonb)
returns table(identity_key text, option_barcode_no text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  req jsonb;
  v_identity text;
  v_kind text;
  v_bcode text;
  v_composition jsonb;
  v_previous_identity text;
  v_existing_no text;
  v_previous_no text;
  v_previous_kind text;
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
    v_previous_identity := btrim(coalesce(req->>'previousIdentityKey', ''));
    v_existing_no := btrim(coalesce(req->>'existingOptionBarcodeNo', ''));
    v_previous_no := null;
    v_previous_kind := null;
    v_no := null;

    if v_identity = '' or v_kind not in ('B_CODE','OPTION','SET') then
      raise exception 'invalid option barcode identity';
    end if;

    select r.option_barcode_no
      into v_no
      from public.option_barcode_registry as r
     where r.identity_key = v_identity;

    if v_no is not null
       and v_existing_no <> ''
       and v_no <> v_existing_no then
      raise exception 'OPTION_BARCODE_IDENTITY_CONFLICT target=% target_no=% existing_no=%',
        v_identity, v_no, v_existing_no;
    end if;

    if v_no is null
       and v_previous_identity <> ''
       and v_previous_identity <> v_identity then
      select r.option_barcode_no, r.identity_kind
        into v_previous_no, v_previous_kind
        from public.option_barcode_registry as r
       where r.identity_key = v_previous_identity;

      if v_previous_no is not null then
        if v_existing_no <> '' and v_previous_no <> v_existing_no then
          raise exception 'OPTION_BARCODE_PREVIOUS_IDENTITY_CONFLICT previous=% previous_no=% existing_no=%',
            v_previous_identity, v_previous_no, v_existing_no;
        end if;

        if upper(coalesce(v_previous_kind, '')) = 'OPTION'
           and v_kind = 'B_CODE' then
          update public.option_barcode_registry as r
             set identity_key = v_identity,
                 identity_kind = v_kind,
                 primary_b_code = v_bcode,
                 composition = v_composition,
                 updated_at = now()
           where r.identity_key = v_previous_identity;
          v_no := v_previous_no;
        end if;
      end if;
    end if;

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

      select r.option_barcode_no
        into v_no
        from public.option_barcode_registry as r
       where r.identity_key = v_identity;
    end if;

    identity_key := v_identity;
    option_barcode_no := v_no;
    return next;
  end loop;
end;
$function$;
