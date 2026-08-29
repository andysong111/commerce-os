-- OptionBarcodeNO is system-owned data. Operators must never type it manually.
-- Guarantee that every normalized option receives its canonical 12-digit number,
-- keep the legacy Shopling payload authority synchronized, and repair/requeue
-- historical registration failures that were caused only by a missing barcode NO.

create or replace function public.sync_product_launch_option_barcode_columns()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_bcode text;
  v_existing_identity text;
  v_identity text;
  v_kind text;
  v_no text;
begin
  new.option_payload := coalesce(new.option_payload, '{}'::jsonb);
  v_bcode := upper(regexp_replace(
    coalesce(nullif(new.barcode, ''), new.option_payload->>'barcode', ''),
    '\s+',
    '',
    'g'
  ));
  v_existing_identity := coalesce(
    nullif(new.option_payload->>'optionBarcodeIdentityKey', ''),
    nullif(new.option_barcode_identity_key, ''),
    ''
  );

  -- Preserve a canonical SET identity when upstream already supplied it.
  -- Otherwise a real B-code is the durable identity. Only options without a
  -- B-code fall back to their stable owner/item/option identity.
  if v_existing_identity like 'SET:%' then
    v_identity := v_existing_identity;
    v_kind := 'SET';
  elsif v_bcode <> '' then
    v_identity := 'B:' || v_bcode;
    v_kind := 'B_CODE';
  elsif v_existing_identity <> '' then
    v_identity := v_existing_identity;
    v_kind := case
      when v_existing_identity like 'SET:%' then 'SET'
      when v_existing_identity like 'B:%' then 'B_CODE'
      else 'OPTION'
    end;
  else
    v_identity := 'OPTION:' || new.owner_id::text || ':' || new.item_id || ':' || new.option_id;
    v_kind := 'OPTION';
  end if;

  select r.option_barcode_no
    into v_no
  from public.resolve_option_barcode_nos(
    jsonb_build_array(
      jsonb_build_object(
        'identityKey', v_identity,
        'identityKind', v_kind,
        'primaryBCode', v_bcode,
        'composition', coalesce(new.option_payload->'setComposition', '[]'::jsonb)
      )
    )
  ) r
  limit 1;

  if v_no is null or v_no !~ '^[0-9]{12}$' then
    raise exception 'OPTION_BARCODE_AUTO_ISSUE_FAILED identity=%', v_identity;
  end if;

  new.option_barcode_no := v_no;
  new.option_barcode_identity_key := v_identity;
  new.option_payload := new.option_payload || jsonb_build_object(
    'optionBarcodeNo', v_no,
    'optionBarcodeIdentityKey', v_identity,
    'optionBarcodeIdentityKind', v_kind
  );
  return new;
end;
$function$;

create or replace function public.ensure_product_launch_item_option_barcode_nos(
  p_owner_id uuid,
  p_item_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_options jsonb := '[]'::jsonb;
  v_nos jsonb := '[]'::jsonb;
  v_option_count integer := 0;
  v_invalid_count integer := 0;
  v_state_updated_at timestamptz;
begin
  if p_owner_id is null or btrim(coalesce(p_item_id, '')) = '' then
    raise exception 'invalid product launch option barcode repair target';
  end if;

  -- A no-op payload write intentionally passes every option through the BEFORE
  -- trigger above. That trigger resolves an existing registry number or creates
  -- a new globally unique 12-digit number when none exists yet.
  update public.product_launch_options o
  set option_payload = coalesce(o.option_payload, '{}'::jsonb),
      updated_at = now()
  where o.owner_id = p_owner_id
    and o.item_id = p_item_id;

  select
    count(*),
    count(*) filter (where o.option_barcode_no !~ '^[0-9]{12}$'),
    coalesce(jsonb_agg(
      coalesce(o.option_payload, '{}'::jsonb) || jsonb_build_object(
        'id', o.option_id,
        'barcode', o.barcode,
        'optionBarcodeNo', o.option_barcode_no,
        'optionBarcodeIdentityKey', o.option_barcode_identity_key,
        'optionBarcodeIdentityKind', case
          when o.option_barcode_identity_key like 'SET:%' then 'SET'
          when o.option_barcode_identity_key like 'B:%' then 'B_CODE'
          else 'OPTION'
        end
      )
      order by o.option_index
    ), '[]'::jsonb),
    coalesce(jsonb_agg(to_jsonb(o.option_barcode_no) order by o.option_index)
      filter (where o.option_barcode_no ~ '^[0-9]{12}$'), '[]'::jsonb)
  into v_option_count, v_invalid_count, v_options, v_nos
  from public.product_launch_options o
  where o.owner_id = p_owner_id
    and o.item_id = p_item_id;

  if v_option_count > 0 and v_invalid_count > 0 then
    raise exception 'OPTION_BARCODE_AUTO_ISSUE_INCOMPLETE item=% invalid=%',
      p_item_id, v_invalid_count;
  end if;

  if v_option_count > 0 then
    update public.product_launch_tracker_states s
    set state_payload = jsonb_set(
          s.state_payload,
          '{items}',
          coalesce((
            select jsonb_agg(
              case
                when item.value->>'id' = p_item_id then
                  jsonb_set(
                    jsonb_set(item.value, '{orderOptions}', v_options, true),
                    '{optionBarcodeNos}', v_nos, true
                  )
                else item.value
              end
              order by item.ordinality
            )
            from jsonb_array_elements(coalesce(s.state_payload->'items', '[]'::jsonb))
              with ordinality item(value, ordinality)
          ), '[]'::jsonb),
          true
        ),
        updated_at = now()
    where s.owner_id = p_owner_id
      and exists (
        select 1
        from jsonb_array_elements(coalesce(s.state_payload->'items', '[]'::jsonb)) item
        where item->>'id' = p_item_id
      )
    returning s.updated_at into v_state_updated_at;

    -- The legacy-state update above marks the normalized read model stale. Both
    -- sides were synchronized in this transaction, so restore the read gate.
    if v_state_updated_at is not null then
      update public.product_launch_workspaces w
      set normalized_read_enabled = true,
          source_state_updated_at = v_state_updated_at,
          updated_at = now()
      where w.owner_id = p_owner_id;
    end if;
  end if;

  return jsonb_build_object(
    'item_id', p_item_id,
    'option_count', v_option_count,
    'repaired', v_option_count > 0,
    'option_barcode_nos', v_nos
  );
end;
$function$;

revoke all on function public.ensure_product_launch_item_option_barcode_nos(uuid, text)
  from public, anon, authenticated;
grant execute on function public.ensure_product_launch_item_option_barcode_nos(uuid, text)
  to service_role;

create or replace function public.ensure_option_barcode_nos_before_seo_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.status = 'ready'
     and new.registration_status in ('queued', 'submitting')
     and old.registration_status is distinct from new.registration_status then
    perform public.ensure_product_launch_item_option_barcode_nos(
      new.owner_id,
      new.launch_item_id
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_seo_run_option_barcode_preflight on public.seo_run_jobs;
create trigger trg_seo_run_option_barcode_preflight
before update of registration_status on public.seo_run_jobs
for each row
execute function public.ensure_option_barcode_nos_before_seo_registration();

-- Repair every stale option already present in normalized storage. This is
-- intentionally generic rather than tied to today's affected product IDs.
do $repair$
declare
  target record;
begin
  for target in
    select distinct o.owner_id, o.item_id
    from public.product_launch_options o
    where o.option_barcode_no !~ '^[0-9]{12}$'
       or btrim(o.option_barcode_identity_key) = ''
  loop
    perform public.ensure_product_launch_item_option_barcode_nos(
      target.owner_id,
      target.item_id
    );
  end loop;
end;
$repair$;

-- Registration failures caused only by the old missing-auto-issue gap are safe
-- to retry automatically. Other data-quality failures remain operator-visible.
update public.seo_run_jobs j
set registration_status = 'queued',
    registration_job_id = '',
    registration_request_id = '',
    registration_payload = coalesce(j.registration_payload, '{}'::jsonb)
      || jsonb_build_object(
        'error', '',
        'nextRetryAt', '',
        'barcodeAutoRepairRequeuedAt', now()
      ),
    updated_at = now()
where j.status = 'ready'
  and j.archived_at is null
  and j.registration_status = 'failed'
  and coalesce(j.registration_payload->>'error', '') like '%옵션바코드NO%';

-- Wake the existing single adaptive scheduler if available; never create a new
-- pg_cron fanout just for this repair.
do $wake$
begin
  if to_regprocedure('public.wake_ops_dispatch_task(text,integer)') is not null then
    perform public.wake_ops_dispatch_task('seo-run-worker', 0);
  end if;
end;
$wake$;
