create table if not exists public.shopling_title_diversification_ledger (
  owner_id uuid not null,
  goods_key text not null,
  registry_registered_at timestamptz,
  status text not null default 'queued',
  claim_run_id text not null default '',
  claimed_at timestamptz,
  outcome text not null default '',
  reason_code text not null default '',
  message text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, goods_key),
  constraint shopling_title_diversification_status_chk check (
    status in ('baseline_processed','queued','claimed','diversified','already_normal','failed','confirm_needed')
  )
);

create index if not exists shopling_title_diversification_queue_idx
  on public.shopling_title_diversification_ledger (status, registry_registered_at, goods_key);
create index if not exists shopling_title_diversification_claim_idx
  on public.shopling_title_diversification_ledger (claim_run_id, status);

alter table public.shopling_title_diversification_ledger enable row level security;
revoke all on table public.shopling_title_diversification_ledger from anon, authenticated;

-- v0.5.3 cutover baseline.
-- Every Shopling goods_key that already exists at migration time is treated as already checked.
-- This intentionally prevents the currently running 599-item first pass from being repeated after extension upgrade.
insert into public.shopling_title_diversification_ledger (
  owner_id,
  goods_key,
  registry_registered_at,
  status,
  outcome,
  reason_code,
  message,
  completed_at,
  created_at,
  updated_at
)
select
  r.owner_id,
  r.goods_key,
  max(r.registered_at),
  'baseline_processed',
  'baseline_processed',
  'v053_cutover_existing_registry',
  'v0.5.3 전환 시점 이전 등록 goods key는 최초 1회 점검 완료 기준선으로 고정했습니다.',
  now(),
  now(),
  now()
from public.shopling_product_group_registry r
where r.shopling_status = 'success'
  and r.goods_key ~ '^[0-9]{5,9}$'
group by r.owner_id, r.goods_key
on conflict (owner_id, goods_key) do nothing;

create or replace function public.claim_shopling_title_diversification_tasks(
  p_run_id text,
  p_limit integer default 500
)
returns table (
  owner_id uuid,
  goods_key text,
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

  -- Only registry rows created after the v0.5.3 baseline can be inserted here.
  insert into public.shopling_title_diversification_ledger (
    owner_id, goods_key, registry_registered_at, status, created_at, updated_at
  )
  select
    r.owner_id,
    r.goods_key,
    max(r.registered_at),
    case
      when bool_or(coalesce(m.title_status, '') = 'ok') then 'already_normal'
      else 'queued'
    end,
    now(),
    now()
  from public.shopling_product_group_registry r
  left join public.shopling_market_pipeline_ledger m
    on m.owner_id = r.owner_id
   and m.goods_key = r.goods_key
  where r.shopling_status = 'success'
    and r.goods_key ~ '^[0-9]{5,9}$'
  group by r.owner_id, r.goods_key
  on conflict (owner_id, goods_key) do nothing;

  -- If the orange one-button pipeline already proved the title stage OK, never reopen it in the purple queue.
  update public.shopling_title_diversification_ledger l
  set status = 'already_normal',
      outcome = 'pipeline_title_ok',
      reason_code = 'market_pipeline_title_ok',
      message = '신규상품 원버튼 처리에서 상품명 단계가 이미 정상 완료되었습니다.',
      completed_at = coalesce(l.completed_at, now()),
      updated_at = now()
  from public.shopling_market_pipeline_ledger m
  where l.owner_id = m.owner_id
    and l.goods_key = m.goods_key
    and l.status = 'queued'
    and m.title_status = 'ok';

  -- Interrupted title work is never silently retried. Recheck is explicit via retry action.
  update public.shopling_title_diversification_ledger
  set status = 'confirm_needed',
      outcome = 'confirm_needed',
      reason_code = case when reason_code = '' then 'stale_title_claim_requires_review' else reason_code end,
      message = case when message = '' then '이전 상품명 분산이 중간 종료되어 자동 재작업을 차단했습니다.' else message end,
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where status = 'claimed'
    and claimed_at < now() - interval '2 hours';

  return query
  with candidates as (
    select l.owner_id, l.goods_key
    from public.shopling_title_diversification_ledger l
    where l.status = 'queued'
    order by l.registry_registered_at asc nulls last, l.goods_key asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 500), 500))
  ), claimed as (
    update public.shopling_title_diversification_ledger l
    set status = 'claimed',
        claim_run_id = trim(p_run_id),
        claimed_at = now(),
        updated_at = now()
    from candidates c
    where l.owner_id = c.owner_id
      and l.goods_key = c.goods_key
      and l.status = 'queued'
    returning l.owner_id, l.goods_key, l.registry_registered_at
  )
  select c.owner_id, c.goods_key, c.registry_registered_at
  from claimed c
  order by c.registry_registered_at asc nulls last, c.goods_key asc;
end;
$$;

create or replace function public.report_shopling_title_diversification_task(
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
  v_updated integer;
begin
  case trim(p_outcome)
    when 'changed' then v_status := 'diversified';
    when 'skipped' then v_status := 'already_normal';
    when 'failed' then v_status := 'failed';
    else raise exception 'invalid_outcome';
  end case;

  update public.shopling_title_diversification_ledger
  set status = v_status,
      outcome = trim(p_outcome),
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

create or replace function public.retry_shopling_title_diversification_failures(
  p_limit integer default 500
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  with targets as (
    select l.owner_id, l.goods_key
    from public.shopling_title_diversification_ledger l
    where l.status in ('failed','confirm_needed')
    order by l.updated_at asc, l.goods_key asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 500), 500))
  )
  update public.shopling_title_diversification_ledger l
  set status = 'queued',
      claim_run_id = '',
      claimed_at = null,
      outcome = '',
      reason_code = '',
      message = '',
      completed_at = null,
      updated_at = now()
  from targets t
  where l.owner_id = t.owner_id
    and l.goods_key = t.goods_key;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.claim_shopling_title_diversification_tasks(text, integer) from public;
revoke all on function public.report_shopling_title_diversification_task(text, text, text, text, text) from public;
revoke all on function public.retry_shopling_title_diversification_failures(integer) from public;
grant execute on function public.claim_shopling_title_diversification_tasks(text, integer) to service_role;
grant execute on function public.report_shopling_title_diversification_task(text, text, text, text, text) to service_role;
grant execute on function public.retry_shopling_title_diversification_failures(integer) to service_role;
