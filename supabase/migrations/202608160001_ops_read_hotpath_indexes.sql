begin;

-- Detail-page review and the global work assistant poll recent detail-page jobs.
-- The hot query filters by owner + payload.kind and orders by updated_at desc.
create index if not exists product_launch_upload_jobs_detail_page_owner_updated_idx
  on public.product_launch_upload_jobs (owner_id, updated_at desc)
  where (payload->>'kind') = 'detail_page';

-- Stage8 diagnostics repeatedly query a single operation type ordered by started_at.
-- Keep those reads from competing with interactive Product Launch Tracker reads.
create index if not exists commerce_operation_runs_type_started_idx
  on public.commerce_operation_runs (operation_type, started_at desc);

commit;
