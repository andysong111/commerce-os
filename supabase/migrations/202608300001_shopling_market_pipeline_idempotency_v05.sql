create table if not exists public.shopling_market_pipeline_ledger (
  owner_id uuid not null,
  goods_key text not null,
  launch_item_id text not null,
  model_number text not null default '',
  product_group_key text not null,
  profile text not null,
  ptn_goods_cd text not null,
  search_prefix text not null default '',
  registry_registered_at timestamptz,
  status text not null default 'queued',
  claim_run_id text not null default '',
  claimed_at timestamptz,
  title_status text not null default 'pending',
  market_status text not null default 'pending',
  submit_armed_at timestamptz,
  reason_code text not null default '',
  message text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, goods_key),
  constraint shopling_market_pipeline_status_chk check (status in ('legacy_ignored','queued','claimed','sent','already_registered','confirm_needed','failed')),
  constraint shopling_market_pipeline_title_status_chk check (title_status in ('legacy_ignored','pending','ok','failed')),
  constraint shopling_market_pipeline_market_status_chk check (market_status in ('legacy_ignored','pending','submit_armed','sent','already_registered','confirm_needed','failed'))
);

create index if not exists shopling_market_pipeline_queue_idx
  on public.shopling_market_pipeline_ledger (status, registry_registered_at, launch_item_id);
create index if not exists shopling_market_pipeline_claim_idx
  on public.shopling_market_pipeline_ledger (claim_run_id, status);

alter table public.shopling_market_pipeline_ledger enable row level security;
revoke all on table public.shopling_market_pipeline_ledger from anon, authenticated;

-- v0.4.0 Production became READY at 2026-08-30 11:17:06Z.
-- Everything older is a permanent legacy baseline and must never enter the new one-button queue.
-- Rows registered after that checkpoint remain eligible; the Shopling worker still re-checks
-- exact ptn_goods_cd + mall-unregistered state before any registration attempt.
insert into public.shopling_market_pipeline_ledger (
  owner_id, goods_key, launch_item_id, model_number, product_group_key, profile,
  ptn_goods_cd, search_prefix, registry_registered_at, status, title_status,
  market_status, completed_at, created_at, updated_at
)
select
  r.owner_id,
  r.goods_key,
  r.launch_item_id,
  r.model_number,
  r.product_group_key,
  case r.product_group_key
    when 'wholesale1' then '도매1'
    when 'wholesale2' then '도매2'
    when 'wholesale3' then '도매3'
    when 'wholesale4' then '도매4'
    when 'retail1' then '소매1'
    when 'retail2' then '소매2'
    else ''
  end,
  r.ptn_goods_cd,
  r.search_prefix,
  r.registered_at,
  case when r.registered_at >= timestamptz '2026-08-30 11:17:06+00' then 'queued' else 'legacy_ignored' end,
  case when r.registered_at >= timestamptz '2026-08-30 11:17:06+00' then 'pending' else 'legacy_ignored' end,
  case when r.registered_at >= timestamptz '2026-08-30 11:17:06+00' then 'pending' else 'legacy_ignored' end,
  case when r.registered_at >= timestamptz '2026-08-30 11:17:06+00' then null else now() end,
  now(),
  now()
from public.shopling_product_group_registry r
where r.shopling_status = 'success'
  and r.registered_at is not null
  and r.product_group_key in ('wholesale1','wholesale2','wholesale3','wholesale4','retail1','retail2')
on conflict (owner_id, goods_key) do nothing;

create or replace function public.claim_shopling_market_pipeline_tasks(
  p_run_id text,
  p_group_limit integer default 50
)
returns table (
  owner_id uuid,
  goods_key text,
  launch_item_id text,
  model_number text,
  product_group_key text,
  profile text,
  ptn_goods_cd text,
  search_prefix text,
  registry_registered_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(p_run_id), '') = '' then
    raise exception 'run_id_required';
  end if;

  insert into public.shopling_market_pipeline_ledger (
    owner_id, goods_key, launch_item_id, model_number, product_group_key, profile,
    ptn_goods_cd, search_prefix, registry_registered_at, status, title_status,
    market_status, created_at, updated_at
  )
  select
    r.owner_id,
    r.goods_key,
    r.launch_item_id,
    r.model_number,
    r.product_group_key,
    case r.product_group_key
      when 'wholesale1' then '도매1'
      when 'wholesale2' then '도매2'
      when 'wholesale3' then '도매3'
      when 'wholesale4' then '도매4'
      when 'retail1' then '소매1'
      when 'retail2' then '소매2'
      else ''
    end,
    r.ptn_goods_cd,
    r.search_prefix,
    r.registered_at,
    'queued',
    'pending',
    'pending',
    now(),
    now()
  from public.shopling_product_group_registry r
  where r.shopling_status = 'success'
    and r.registered_at is not null
    and r.product_group_key in ('wholesale1','wholesale2','wholesale3','wholesale4','retail1','retail2')
  on conflict (owner_id, goods_key) do nothing;

  -- Never silently requeue an interrupted claim. It might have crossed the Shopling submit boundary.
  update public.shopling_market_pipeline_ledger
  set status = 'confirm_needed',
      market_status = case when market_status = 'submit_armed' then 'confirm_needed' else market_status end,
      reason_code = case when reason_code = '' then 'stale_claim_requires_review' else reason_code end,
      message = case when message = '' then '이전 자동처리가 중간 종료되어 자동 재작업을 차단했습니다.' else message end,
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where status = 'claimed'
    and claimed_at < now() - interval '2 hours';

  return query
  with eligible_groups as (
    select l.owner_id, l.launch_item_id, min(l.registry_registered_at) as first_registered_at
    from public.shopling_market_pipeline_ledger l
    where l.status = 'queued'
    group by l.owner_id, l.launch_item_id
    having count(*) = 6
       and count(distinct l.product_group_key) = 6
       and bool_and(l.product_group_key in ('wholesale1','wholesale2','wholesale3','wholesale4','retail1','retail2'))
    order by min(l.registry_registered_at) asc nulls last, l.launch_item_id asc
    limit greatest(1, least(coalesce(p_group_limit, 50), 50))
  ), claimed as (
    update public.shopling_market_pipeline_ledger l
    set status = 'claimed',
        claim_run_id = trim(p_run_id),
        claimed_at = now(),
        updated_at = now()
    from eligible_groups g
    where l.owner_id = g.owner_id
      and l.launch_item_id = g.launch_item_id
      and l.status = 'queued'
    returning l.owner_id, l.goods_key, l.launch_item_id, l.model_number,
              l.product_group_key, l.profile, l.ptn_goods_cd, l.search_prefix,
              l.registry_registered_at
  )
  select c.owner_id, c.goods_key, c.launch_item_id, c.model_number,
         c.product_group_key, c.profile, c.ptn_goods_cd, c.search_prefix,
         c.registry_registered_at
  from claimed c
  order by c.registry_registered_at asc nulls last,
           c.launch_item_id asc,
           case c.product_group_key
             when 'wholesale1' then 1
             when 'wholesale2' then 2
             when 'wholesale3' then 3
             when 'wholesale4' then 4
             when 'retail1' then 5
             when 'retail2' then 6
             else 99
           end;
end;
$$;

create or replace function public.arm_shopling_market_pipeline_submit(
  p_run_id text,
  p_goods_key text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.shopling_market_pipeline_ledger
  set market_status = 'submit_armed',
      submit_armed_at = now(),
      updated_at = now()
  where claim_run_id = trim(p_run_id)
    and goods_key = trim(p_goods_key)
    and status = 'claimed'
    and market_status = 'pending';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.report_shopling_market_pipeline_task(
  p_run_id text,
  p_goods_key text,
  p_outcome text,
  p_reason_code text default '',
  p_message text default ''
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_title_status text;
  v_market_status text;
  v_updated integer;
begin
  case trim(p_outcome)
    when 'sent' then
      v_status := 'sent'; v_title_status := 'ok'; v_market_status := 'sent';
    when 'already_registered' then
      v_status := 'already_registered'; v_title_status := 'ok'; v_market_status := 'already_registered';
    when 'confirm_needed' then
      v_status := 'confirm_needed'; v_title_status := 'ok'; v_market_status := 'confirm_needed';
    when 'title_failed' then
      v_status := 'failed'; v_title_status := 'failed'; v_market_status := 'failed';
    when 'failed' then
      v_status := 'failed'; v_title_status := 'ok'; v_market_status := 'failed';
    else
      raise exception 'invalid_outcome';
  end case;

  update public.shopling_market_pipeline_ledger
  set status = v_status,
      title_status = v_title_status,
      market_status = v_market_status,
      reason_code = left(coalesce(p_reason_code, ''), 120),
      message = left(coalesce(p_message, ''), 1000),
      completed_at = now(),
      updated_at = now()
  where claim_run_id = trim(p_run_id)
    and goods_key = trim(p_goods_key)
    and status = 'claimed';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.claim_shopling_market_pipeline_tasks(text, integer) from public;
revoke all on function public.arm_shopling_market_pipeline_submit(text, text) from public;
revoke all on function public.report_shopling_market_pipeline_task(text, text, text, text, text) from public;
grant execute on function public.claim_shopling_market_pipeline_tasks(text, integer) to service_role;
grant execute on function public.arm_shopling_market_pipeline_submit(text, text) to service_role;
grant execute on function public.report_shopling_market_pipeline_task(text, text, text, text, text) to service_role;
