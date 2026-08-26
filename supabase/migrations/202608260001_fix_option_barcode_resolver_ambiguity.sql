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
