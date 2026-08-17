create index if not exists product_launch_upload_jobs_owner_detail_page_updated_idx
  on public.product_launch_upload_jobs (owner_id, updated_at desc)
  where payload->>'kind' = 'detail_page';

create index if not exists product_launch_upload_jobs_active_detail_page_updated_idx
  on public.product_launch_upload_jobs (updated_at asc)
  where payload->>'kind' = 'detail_page'
    and status in ('queued','running');
