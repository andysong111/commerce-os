-- Internal detail-page OpenAI cost ledger.
-- Apply manually after PR review and Preview verification.

create table if not exists public.detail_page_cost_events (
  id bigint generated always as identity primary key,
  run_id text not null check (char_length(run_id) between 1 and 200),
  event_type text not null check (event_type in (
    'product_analysis',
    'image_generation',
    'visual_verifier',
    'color_verifier'
  )),
  generation_profile text not null check (generation_profile in (
    'draft',
    'standard',
    'premium'
  )),
  model text not null check (char_length(model) between 1 and 200),
  image_quality text check (
    image_quality is null or image_quality in ('low', 'medium', 'high')
  ),
  image_size text,
  slot integer check (slot is null or slot between 1 and 8),
  product_name text not null default '',
  output_language text not null default '',
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  cached_input_tokens bigint not null default 0 check (cached_input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  input_text_tokens bigint not null default 0 check (input_text_tokens >= 0),
  input_image_tokens bigint not null default 0 check (input_image_tokens >= 0),
  output_text_tokens bigint not null default 0 check (output_text_tokens >= 0),
  output_image_tokens bigint not null default 0 check (output_image_tokens >= 0),
  estimated_cost_usd numeric(18, 10) check (
    estimated_cost_usd is null or estimated_cost_usd >= 0
  ),
  pricing_status text not null check (pricing_status in ('estimated', 'unpriced')),
  pricing_version text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists detail_page_cost_events_created
  on public.detail_page_cost_events(created_at desc);
create index if not exists detail_page_cost_events_run_created
  on public.detail_page_cost_events(run_id, created_at);
create index if not exists detail_page_cost_events_type_created
  on public.detail_page_cost_events(event_type, created_at desc);

alter table public.detail_page_cost_events enable row level security;
revoke all on public.detail_page_cost_events from public, anon, authenticated;
grant select, insert on public.detail_page_cost_events to service_role;
grant usage, select on sequence public.detail_page_cost_events_id_seq to service_role;

create or replace function public.get_detail_page_cost_summary()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total_cost_usd',
      coalesce(sum(estimated_cost_usd), 0),
    'today_cost_usd',
      coalesce(sum(estimated_cost_usd) filter (
        where created_at >= date_trunc('day', now() at time zone 'Asia/Seoul')
          at time zone 'Asia/Seoul'
      ), 0),
    'run_count',
      count(distinct run_id),
    'today_run_count',
      count(distinct run_id) filter (
        where created_at >= date_trunc('day', now() at time zone 'Asia/Seoul')
          at time zone 'Asia/Seoul'
      ),
    'event_count',
      count(*),
    'unpriced_event_count',
      count(*) filter (where pricing_status = 'unpriced')
  )
  from public.detail_page_cost_events;
$$;

revoke all on function public.get_detail_page_cost_summary()
  from public, anon, authenticated;
grant execute on function public.get_detail_page_cost_summary()
  to service_role;
