begin;

create or replace function public.claim_seo_title_dispatch_direct_apply(
  p_owner_id uuid,
  p_dispatch_id uuid,
  p_request_id text,
  p_result_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  update public.seo_title_dispatches
  set external_request_id = p_request_id,
      result_payload = coalesce(p_result_payload, '{}'::jsonb),
      updated_at = now()
  where owner_id = p_owner_id
    and dispatch_id = p_dispatch_id
    and status = 'submitted'
    and coalesce(result_payload->>'phase', '') in (
      'base_upload_preparing',
      'base_upload_dispatching',
      'base_upload_queued',
      'start_uncertain'
    );

  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.claim_seo_title_dispatch_direct_apply(uuid, uuid, text, jsonb) from public;
revoke all on function public.claim_seo_title_dispatch_direct_apply(uuid, uuid, text, jsonb) from anon;
revoke all on function public.claim_seo_title_dispatch_direct_apply(uuid, uuid, text, jsonb) from authenticated;
grant execute on function public.claim_seo_title_dispatch_direct_apply(uuid, uuid, text, jsonb) to service_role;

commit;
