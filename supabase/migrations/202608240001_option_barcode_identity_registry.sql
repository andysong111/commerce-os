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
