begin;

create unique index if not exists seo_title_dispatches_one_active_per_ledger_idx
  on public.seo_title_dispatches (owner_id, ledger_id)
  where status in ('reserved', 'ready', 'submitted');

create index if not exists seo_title_dispatches_submitted_updated_idx
  on public.seo_title_dispatches (updated_at asc)
  where status = 'submitted';

commit;
