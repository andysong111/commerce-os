-- Fix PL/pgSQL output-variable ambiguity in Shopling claim RPCs.
-- RETURNS TABLE(owner_id, goods_key, ...) creates PL/pgSQL variables with those names,
-- so `ON CONFLICT (owner_id, goods_key)` can be parsed ambiguously.
-- Use explicit primary-key constraint names instead; queue/idempotency semantics are unchanged.

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
  on conflict on constraint shopling_market_pipeline_ledger_pkey do nothing;

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

  insert into public.shopling_title_diversification_ledger (
    owner_id, goods_key, registry_registered_at, status, created_at, updated_at
  )
  select
    r.owner_id,
    r.goods_key,
    max(r.registered_at),
    case when bool_or(coalesce(m.title_status, '') = 'ok') then 'already_normal' else 'queued' end,
    now(),
    now()
  from public.shopling_product_group_registry r
  left join public.shopling_market_pipeline_ledger m
    on m.owner_id = r.owner_id
   and m.goods_key = r.goods_key
  where r.shopling_status = 'success'
    and r.goods_key ~ '^[0-9]{5,9}$'
  group by r.owner_id, r.goods_key
  on conflict on constraint shopling_title_diversification_ledger_pkey do nothing;

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

revoke all on function public.claim_shopling_market_pipeline_tasks(text, integer) from public;
revoke all on function public.claim_shopling_market_pipeline_tasks(text, integer) from anon, authenticated;
grant execute on function public.claim_shopling_market_pipeline_tasks(text, integer) to service_role;

revoke all on function public.claim_shopling_title_diversification_tasks(text, integer) from public;
revoke all on function public.claim_shopling_title_diversification_tasks(text, integer) from anon, authenticated;
grant execute on function public.claim_shopling_title_diversification_tasks(text, integer) to service_role;
