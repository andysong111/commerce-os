create or replace function public.product_launch_mark_normalized_stale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.product_launch_workspaces
  set normalized_read_enabled = false,
      updated_at = now()
  where owner_id = new.owner_id;
  return new;
end;
$$;

drop trigger if exists product_launch_mark_normalized_stale on public.product_launch_tracker_states;
create trigger product_launch_mark_normalized_stale
after update of state_payload on public.product_launch_tracker_states
for each row
when (old.state_payload is distinct from new.state_payload)
execute function public.product_launch_mark_normalized_stale();

create or replace function public.product_launch_promote_fresh_normalized()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_updated_at timestamptz;
begin
  if new.source_state_updated_at is not distinct from old.source_state_updated_at then
    return new;
  end if;

  select s.updated_at
  into v_source_updated_at
  from public.product_launch_tracker_states s
  where s.owner_id = new.owner_id;

  if v_source_updated_at is not null
     and new.source_state_updated_at = v_source_updated_at then
    new.normalized_read_enabled := true;
  end if;
  return new;
end;
$$;

drop trigger if exists product_launch_promote_fresh_normalized on public.product_launch_workspaces;
create trigger product_launch_promote_fresh_normalized
before update of source_state_updated_at on public.product_launch_workspaces
for each row
execute function public.product_launch_promote_fresh_normalized();

revoke execute on function public.product_launch_mark_normalized_stale() from public;
revoke execute on function public.product_launch_mark_normalized_stale() from anon;
revoke execute on function public.product_launch_mark_normalized_stale() from authenticated;
revoke execute on function public.product_launch_promote_fresh_normalized() from public;
revoke execute on function public.product_launch_promote_fresh_normalized() from anon;
revoke execute on function public.product_launch_promote_fresh_normalized() from authenticated;

create index if not exists product_launch_items_owner_updated_model_idx
  on public.product_launch_items (owner_id, updated_at desc, model_number desc);
create index if not exists product_launch_items_owner_unfinished_updated_model_idx
  on public.product_launch_items (owner_id, updated_at desc, model_number desc)
  where overall_status not in ('완료','보관됨');
