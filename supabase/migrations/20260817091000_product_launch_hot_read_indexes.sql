create extension if not exists pg_trgm with schema extensions;

create index if not exists product_launch_items_search_text_trgm_idx
  on public.product_launch_items using gin (search_text extensions.gin_trgm_ops);
create index if not exists product_launch_items_assignees_gin_idx
  on public.product_launch_items using gin (assignees);
create index if not exists product_launch_items_owner_product_name_idx
  on public.product_launch_items (owner_id, product_name, updated_at desc);
create index if not exists product_launch_items_owner_category_idx
  on public.product_launch_items (owner_id, shopling_category, updated_at desc);
create index if not exists product_launch_items_owner_next_stage_idx
  on public.product_launch_items (owner_id, next_stage, updated_at desc);
create index if not exists product_launch_items_owner_detail_page_idx
  on public.product_launch_items (owner_id, detail_page_status, updated_at desc);
create index if not exists product_launch_items_owner_price_keyword_idx
  on public.product_launch_items (owner_id, price_keyword_status, updated_at desc);
create index if not exists product_launch_items_owner_shopling_upload_idx
  on public.product_launch_items (owner_id, shopling_upload_status, updated_at desc);
create index if not exists product_launch_items_owner_market_registration_idx
  on public.product_launch_items (owner_id, market_registration_status, updated_at desc);
create index if not exists product_launch_items_owner_order_mapping_idx
  on public.product_launch_items (owner_id, order_mapping_status, updated_at desc);
create index if not exists product_launch_items_owner_inventory_reflection_idx
  on public.product_launch_items (owner_id, inventory_reflection_status, updated_at desc);
create index if not exists product_launch_items_owner_readiness_idx
  on public.product_launch_items (owner_id, readiness_ready, updated_at desc);
