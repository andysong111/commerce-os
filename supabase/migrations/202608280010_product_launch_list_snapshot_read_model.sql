-- Keep the hot product-launch list read away from the multi-megabyte legacy
-- state_payload TOAST value. The existing state remains the compatibility source;
-- this trigger maintains one compact list snapshot row per owner.

create table if not exists public.product_launch_list_snapshots (
  owner_id uuid primary key,
  owner_email text not null default '',
  schema_version integer not null default 3,
  snapshot_version integer not null default 1,
  item_count integer not null default 0 check (item_count >= 0),
  snapshot_payload jsonb not null,
  source_state_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_launch_list_snapshots_updated_idx
  on public.product_launch_list_snapshots (updated_at desc);

alter table public.product_launch_list_snapshots enable row level security;
revoke all on table public.product_launch_list_snapshots from public, anon, authenticated;
grant select, insert, update, delete on table public.product_launch_list_snapshots to service_role;

create or replace function public.sync_product_launch_list_snapshot_read_model()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_snapshot jsonb;
  v_snapshot_version integer := 1;
  v_item_count integer := 0;
begin
  v_snapshot := new.state_payload -> 'productLaunchListSnapshot';

  -- Preserve the last known-good read model if an old/partial writer submits a
  -- payload without a valid snapshot. Current application writes always include it.
  if jsonb_typeof(v_snapshot) <> 'object'
     or jsonb_typeof(v_snapshot -> 'summaries') <> 'array' then
    return new;
  end if;

  if coalesce(v_snapshot ->> 'version', '') ~ '^[0-9]+$' then
    v_snapshot_version := greatest(1, (v_snapshot ->> 'version')::integer);
  end if;
  v_item_count := jsonb_array_length(v_snapshot -> 'summaries');

  insert into public.product_launch_list_snapshots (
    owner_id,
    owner_email,
    schema_version,
    snapshot_version,
    item_count,
    snapshot_payload,
    source_state_updated_at,
    updated_at
  )
  values (
    new.owner_id,
    new.owner_email,
    new.schema_version,
    v_snapshot_version,
    v_item_count,
    v_snapshot,
    new.updated_at,
    now()
  )
  on conflict (owner_id) do update
  set owner_email = excluded.owner_email,
      schema_version = excluded.schema_version,
      snapshot_version = excluded.snapshot_version,
      item_count = excluded.item_count,
      snapshot_payload = excluded.snapshot_payload,
      source_state_updated_at = excluded.source_state_updated_at,
      updated_at = now();

  return new;
end;
$function$;

drop trigger if exists product_launch_tracker_states_sync_list_snapshot
  on public.product_launch_tracker_states;
create trigger product_launch_tracker_states_sync_list_snapshot
after insert or update of state_payload, owner_email, schema_version, updated_at
on public.product_launch_tracker_states
for each row execute function public.sync_product_launch_list_snapshot_read_model();

insert into public.product_launch_list_snapshots (
  owner_id,
  owner_email,
  schema_version,
  snapshot_version,
  item_count,
  snapshot_payload,
  source_state_updated_at,
  updated_at
)
select
  state.owner_id,
  state.owner_email,
  state.schema_version,
  case
    when coalesce(state.state_payload #>> '{productLaunchListSnapshot,version}', '') ~ '^[0-9]+$'
      then greatest(1, (state.state_payload #>> '{productLaunchListSnapshot,version}')::integer)
    else 1
  end,
  jsonb_array_length(state.state_payload #> '{productLaunchListSnapshot,summaries}'),
  state.state_payload -> 'productLaunchListSnapshot',
  state.updated_at,
  now()
from public.product_launch_tracker_states state
where jsonb_typeof(state.state_payload -> 'productLaunchListSnapshot') = 'object'
  and jsonb_typeof(state.state_payload #> '{productLaunchListSnapshot,summaries}') = 'array'
on conflict (owner_id) do update
set owner_email = excluded.owner_email,
    schema_version = excluded.schema_version,
    snapshot_version = excluded.snapshot_version,
    item_count = excluded.item_count,
    snapshot_payload = excluded.snapshot_payload,
    source_state_updated_at = excluded.source_state_updated_at,
    updated_at = now();

revoke all on function public.sync_product_launch_list_snapshot_read_model()
  from public, anon, authenticated;
grant execute on function public.sync_product_launch_list_snapshot_read_model()
  to service_role;

comment on table public.product_launch_list_snapshots is
  'Compact one-row-per-owner product launch list read model maintained from the legacy state snapshot.';
