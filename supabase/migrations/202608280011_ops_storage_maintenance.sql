-- Bounded hot/cold maintenance for tables that can grow continuously.
-- Business evidence is preserved. SEO RUNs are only marked archived (still
-- queryable with includeArchived), and only extension-owned scheduler logs are
-- physically pruned.

create index if not exists commerce_operation_runs_type_status_started_idx
  on public.commerce_operation_runs (operation_type, status, started_at desc)
  include (source_event_id, correlation_id);

create index if not exists commerce_operation_runs_started_brin_idx
  on public.commerce_operation_runs using brin (started_at)
  with (pages_per_range = 32);

create index if not exists seo_run_jobs_owner_hot_list_idx
  on public.seo_run_jobs (owner_id, run_created_at desc, created_at desc, run_id)
  where archived_at is null;

create or replace function public.run_ops_storage_maintenance(
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 5000));
  v_seo_archived integer := 0;
  v_cron_pruned integer := 0;
  v_net_pruned integer := 0;
begin
  with candidates as (
    select run_id
    from public.seo_run_jobs
    where archived_at is null
      and (
        (
          status = 'ready'
          and registration_status = 'success'
          and coalesce(completed_at, updated_at) < now() - interval '30 days'
        )
        or (
          status in ('failed', 'cancelled')
          and coalesce(completed_at, updated_at) < now() - interval '90 days'
        )
      )
    order by coalesce(completed_at, updated_at) asc, run_id asc
    limit v_limit
    for update skip locked
  )
  update public.seo_run_jobs job
  set archived_at = now(),
      lease_owner = null,
      lease_until = null,
      updated_at = now()
  from candidates
  where job.run_id = candidates.run_id;
  get diagnostics v_seo_archived = row_count;

  if to_regclass('cron.job_run_details') is not null then
    execute $sql$
      with stale as (
        select runid
        from cron.job_run_details
        where coalesce(end_time, start_time) < now() - interval '7 days'
        order by runid asc
        limit $1
      )
      delete from cron.job_run_details details
      using stale
      where details.runid = stale.runid
    $sql$ using v_limit;
    get diagnostics v_cron_pruned = row_count;
  end if;

  -- pg_net responses are transport diagnostics, not business records. Keep a
  -- short troubleshooting window and prune in small batches when the extension
  -- table exists.
  if to_regclass('net._http_response') is not null then
    execute $sql$
      with stale as (
        select id
        from net._http_response
        where created < now() - interval '2 days'
        order by created asc
        limit $1
      )
      delete from net._http_response response
      using stale
      where response.id = stale.id
    $sql$ using v_limit;
    get diagnostics v_net_pruned = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'seo_runs_archived', v_seo_archived,
    'cron_rows_pruned', v_cron_pruned,
    'pg_net_rows_pruned', v_net_pruned,
    'limit', v_limit,
    'completed_at', now()
  );
end;
$function$;

revoke all on function public.run_ops_storage_maintenance(integer)
  from public, anon, authenticated;
grant execute on function public.run_ops_storage_maintenance(integer)
  to service_role;

comment on function public.run_ops_storage_maintenance(integer) is
  'Bounded hot/cold maintenance: archive terminal SEO RUNs and prune extension-owned transport logs without deleting business evidence.';
