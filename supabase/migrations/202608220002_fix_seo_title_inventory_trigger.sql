-- Correct the inventory -> ledger touch trigger for INSERT / UPDATE / DELETE.
-- The first migration is retained as the immutable schema history; this patch
-- makes fresh migration runs and production consistent.

create or replace function public.touch_seo_title_ledger_from_inventory()
returns trigger
language plpgsql
as $$
declare
  target_ledger_id uuid;
begin
  target_ledger_id := case
    when tg_op = 'DELETE' then old.ledger_id
    else new.ledger_id
  end;

  update public.seo_title_ledgers
  set updated_at = now()
  where ledger_id = target_ledger_id;

  return null;
end;
$$;
