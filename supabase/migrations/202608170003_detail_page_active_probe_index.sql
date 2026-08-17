create index if not exists product_launch_upload_jobs_detail_active_owner_status_idx
on public.product_launch_upload_jobs (owner_id, status, updated_at desc)
where (payload ->> 'kind') = 'detail_page'
  and status in ('queued', 'running');
