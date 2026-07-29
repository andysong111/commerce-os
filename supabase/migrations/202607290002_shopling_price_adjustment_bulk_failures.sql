-- Failure transition used by the 10,000-item price-adjustment orchestrator.

create or replace function public.fail_shopling_price_adjustment_bulk_job(
  p_job_id uuid,
  p_owner_id uuid,
  p_chunk_id uuid,
  p_error text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  update public.shopling_price_adjustment_bulk_chunks chunk
  set status = 'failed',
      last_error = left(coalesce(p_error,'bulk stage failed'),2000),
      completed_at = now(),
      updated_at = now()
  from public.shopling_price_adjustment_bulk_jobs job
  where chunk.id = p_chunk_id
    and chunk.job_id = job.id
    and job.id = p_job_id
    and job.owner_id = p_owner_id
    and job.status = 'running'
    and chunk.status in ('pending','planning','ready','executing');
  if not found then raise exception 'invalid bulk failure transition'; end if;

  update public.shopling_price_adjustment_bulk_items
  set status = 'not_executed', updated_at = now()
  where job_id = p_job_id and status in ('pending','running');

  update public.shopling_price_adjustment_bulk_jobs
  set status = 'failed',
      last_error = left(coalesce(p_error,'bulk stage failed'),2000),
      worker_id = null,
      lease_until = null,
      updated_at = now()
  where id = p_job_id and owner_id = p_owner_id;
end $$;

revoke all on function public.fail_shopling_price_adjustment_bulk_job(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.fail_shopling_price_adjustment_bulk_job(uuid,uuid,uuid,text) to service_role;
