-- Aggregate complete recent detail-page runs instead of truncating raw events.

create or replace function public.get_recent_detail_page_cost_runs(
  requested_limit integer default 30
)
returns table (
  run_id text,
  product_name text,
  output_language text,
  generation_profile text,
  created_at timestamptz,
  cost_usd numeric,
  event_count bigint,
  image_calls bigint,
  verifier_calls bigint,
  has_unpriced_event boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with recent_runs as materialized (
    select
      event.run_id,
      max(event.created_at) as created_at
    from public.detail_page_cost_events as event
    group by event.run_id
    order by created_at desc
    limit least(greatest(coalesce(requested_limit, 30), 1), 100)
  )
  select
    recent.run_id,
    (array_agg(
      event.product_name
      order by event.created_at desc, event.id desc
    ))[1] as product_name,
    (array_agg(
      event.output_language
      order by event.created_at desc, event.id desc
    ))[1] as output_language,
    (array_agg(
      event.generation_profile
      order by event.created_at desc, event.id desc
    ))[1] as generation_profile,
    recent.created_at,
    coalesce(sum(event.estimated_cost_usd), 0) as cost_usd,
    count(*) as event_count,
    count(*) filter (
      where event.event_type = 'image_generation'
    ) as image_calls,
    count(*) filter (
      where event.event_type in ('visual_verifier', 'color_verifier')
    ) as verifier_calls,
    bool_or(event.pricing_status = 'unpriced') as has_unpriced_event
  from recent_runs as recent
  join public.detail_page_cost_events as event
    on event.run_id = recent.run_id
  group by recent.run_id, recent.created_at
  order by recent.created_at desc;
$$;

revoke all on function public.get_recent_detail_page_cost_runs(integer)
  from public, anon, authenticated;
grant execute on function public.get_recent_detail_page_cost_runs(integer)
  to service_role;
