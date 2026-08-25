-- Updating an option barcode mirror must not rewrite the parent item's business timestamp.
-- product_launch_items.updated_at is used for stable item ordering and must continue to
-- reflect the product-launch item mutation itself, not option-barcode housekeeping.

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
       where o.owner_id = v_owner
         and o.item_id = v_item
     ), '{}'::text[])
   where i.owner_id = v_owner
     and i.item_id = v_item;

  return coalesce(new, old);
end;
$$;
