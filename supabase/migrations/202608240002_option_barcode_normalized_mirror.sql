create or replace function public.sync_product_launch_option_barcode_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.option_barcode_no := coalesce(
    nullif(new.option_payload->>'optionBarcodeNo',''),
    new.option_barcode_no,
    ''
  );
  new.option_barcode_identity_key := coalesce(
    nullif(new.option_payload->>'optionBarcodeIdentityKey',''),
    new.option_barcode_identity_key,
    ''
  );
  return new;
end;
$$;

drop trigger if exists trg_product_launch_option_barcode_columns
  on public.product_launch_options;
create trigger trg_product_launch_option_barcode_columns
before insert or update on public.product_launch_options
for each row execute function public.sync_product_launch_option_barcode_columns();

create or replace function public.refresh_product_launch_item_option_barcodes()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_owner uuid;
  v_item text;
begin
  v_owner := coalesce(new.owner_id, old.owner_id);
  v_item := coalesce(new.item_id, old.item_id);
  update public.product_launch_items i
     set option_barcode_nos = coalesce((
       select array_agg(o.option_barcode_no order by o.option_index)
         filter (where o.option_barcode_no <> '')
       from public.product_launch_options o
       where o.owner_id = v_owner and o.item_id = v_item
     ), '{}'::text[]),
         updated_at = now()
   where i.owner_id = v_owner and i.item_id = v_item;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_refresh_product_launch_item_option_barcodes
  on public.product_launch_options;
create trigger trg_refresh_product_launch_item_option_barcodes
after insert or update or delete on public.product_launch_options
for each row execute function public.refresh_product_launch_item_option_barcodes();
