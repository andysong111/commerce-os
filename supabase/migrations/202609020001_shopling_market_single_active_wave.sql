create or replace function public.enforce_shopling_market_single_active_wave()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'claimed'
     and coalesce(new.claim_run_id, '') <> ''
     and (old.status is distinct from new.status or old.claim_run_id is distinct from new.claim_run_id) then
    perform pg_advisory_xact_lock(
      hashtextextended(coalesce(new.owner_id::text, '') || ':' || coalesce(new.launch_item_id::text, ''), 0)
    );

    if exists (
      select 1
      from public.shopling_market_pipeline_ledger l
      where l.owner_id = new.owner_id
        and l.launch_item_id = new.launch_item_id
        and l.goods_key <> new.goods_key
        and l.status = 'claimed'
        and coalesce(l.claim_run_id, '') <> ''
        and l.claim_run_id <> new.claim_run_id
    ) then
      raise exception using errcode = 'P0001', message = 'SHOPLING_ACTIVE_WAVE_EXISTS';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_shopling_market_single_active_wave on public.shopling_market_pipeline_ledger;
create trigger trg_shopling_market_single_active_wave
before update of status, claim_run_id on public.shopling_market_pipeline_ledger
for each row
execute function public.enforce_shopling_market_single_active_wave();
