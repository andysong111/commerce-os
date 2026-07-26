alter table public.shopling_price_bulk_jobs drop constraint if exists shopling_price_bulk_jobs_status_check;
alter table public.shopling_price_bulk_jobs add constraint shopling_price_bulk_jobs_status_check check (status in
 ('prepared','canary_dispatching','canary_running','canary_succeeded','canary_failed','normal_running','normal_succeeded','normal_failed','dispatch_uncertain','cancelled'));

create or replace function public.approve_shopling_price_bulk_normal_execution(p_job_id uuid,p_owner_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_job public.shopling_price_bulk_jobs; v_chunks int; v_goods int;
begin
 if auth.role()<>'service_role' then raise exception 'service_role required'; end if;
 select * into v_job from public.shopling_price_bulk_jobs where id=p_job_id and owner_id=p_owner_id for update;
 if v_job.id is null then raise exception 'job not found'; end if;
 if v_job.status<>'canary_succeeded' then raise exception 'canary has not succeeded'; end if;
 if not exists(select 1 from public.shopling_price_bulk_chunks where job_id=p_job_id and chunk_type='canary' and status='succeeded') then raise exception 'canary chunk has not succeeded'; end if;
 select count(*),coalesce(sum(goods_key_count),0) into v_chunks,v_goods from public.shopling_price_bulk_chunks where job_id=p_job_id and chunk_type='normal';
 if v_chunks=0 then raise exception 'normal chunk is empty'; end if;
 if exists(select 1 from public.shopling_price_bulk_chunks where job_id=p_job_id and chunk_type='normal' and status<>'pending') then raise exception 'all normal chunks must be pending'; end if;
 if exists(select 1 from public.shopling_price_bulk_chunks where job_id=p_job_id and status in ('dispatching','running','dispatch_uncertain')) then raise exception 'active chunk exists'; end if;
 update public.shopling_price_bulk_jobs set status='normal_running',updated_at=now(),last_error=null where id=p_job_id;
 return jsonb_build_object('status','normal_running','normal_chunk_count',v_chunks,'normal_goods_key_count',v_goods);
end $$;

create or replace function public.reserve_next_shopling_price_bulk_normal_chunk(p_job_id uuid,p_owner_id uuid,p_request_id text) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_job public.shopling_price_bulk_jobs; v_chunk public.shopling_price_bulk_chunks;
begin
 if auth.role()<>'service_role' then raise exception 'service_role required'; end if;
 if p_request_id is null or p_request_id !~ '^[A-Za-z0-9._:-]{1,120}$' then raise exception 'invalid request id'; end if;
 select * into v_job from public.shopling_price_bulk_jobs where id=p_job_id and owner_id=p_owner_id for update;
 if v_job.id is null then raise exception 'job not found'; end if;
 if v_job.status<>'normal_running' then raise exception 'normal execution is not running'; end if;
 if exists(select 1 from public.shopling_price_bulk_chunks where job_id=p_job_id and status in ('dispatching','running','dispatch_uncertain')) then raise exception 'active chunk exists'; end if;
 select * into v_chunk from public.shopling_price_bulk_chunks where job_id=p_job_id and chunk_type='normal' and status='pending' and attempt_count=0 order by chunk_index asc limit 1 for update skip locked;
 if v_chunk.id is null then
   if exists(select 1 from public.shopling_price_bulk_chunks where job_id=p_job_id and chunk_type='normal' and status<>'succeeded') then raise exception 'no reservable normal chunk'; end if;
   update public.shopling_price_bulk_jobs set status='normal_succeeded',updated_at=now() where id=p_job_id;
   return jsonb_build_object('completed',true,'status','normal_succeeded');
 end if;
 update public.shopling_price_bulk_chunks set status='dispatching',request_id=p_request_id,attempt_count=attempt_count+1,started_at=now(),updated_at=now(),last_error=null where id=v_chunk.id;
 return jsonb_build_object('completed',false,'job_id',p_job_id,'chunk_id',v_chunk.id,'chunk_index',v_chunk.chunk_index,'goods_keys',v_chunk.goods_keys,'goods_key_count',v_chunk.goods_key_count,'request_id',p_request_id,'policy_overrides',v_job.policy_overrides);
end $$;

create or replace function public.mark_shopling_price_bulk_normal_running(p_job_id uuid,p_owner_id uuid,p_request_id text,p_actions_url text) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 if auth.role()<>'service_role' then raise exception 'service_role required'; end if;
 update public.shopling_price_bulk_chunks c set status='running',actions_url=p_actions_url,updated_at=now() from public.shopling_price_bulk_jobs j where c.job_id=j.id and j.id=p_job_id and j.owner_id=p_owner_id and j.status='normal_running' and c.chunk_type='normal' and c.status='dispatching' and c.request_id=p_request_id returning c.id into v_id;
 if v_id is null then raise exception 'invalid normal running transition'; end if;
 return jsonb_build_object('chunk_id',v_id,'status','running');
end $$;

create or replace function public.fail_shopling_price_bulk_normal_dispatch_rejected(p_job_id uuid,p_owner_id uuid,p_request_id text,p_error text) returns void language plpgsql security definer set search_path=public as $$
declare v_chunk_id uuid;
begin
 if auth.role()<>'service_role' then raise exception 'service_role required'; end if;
 update public.shopling_price_bulk_chunks c set status='failed',last_error=left(coalesce(p_error,'dispatch rejected'),1000),completed_at=now(),updated_at=now() from public.shopling_price_bulk_jobs j where c.job_id=j.id and j.id=p_job_id and j.owner_id=p_owner_id and c.chunk_type='normal' and c.status='dispatching' and c.request_id=p_request_id returning c.id into v_chunk_id;
 if v_chunk_id is null then raise exception 'invalid normal dispatch rejected transition'; end if;
 update public.shopling_price_bulk_jobs set status='normal_failed',last_error=left(coalesce(p_error,'dispatch rejected'),1000),updated_at=now() where id=p_job_id and owner_id=p_owner_id;
end $$;

create or replace function public.block_shopling_price_bulk_normal_uncertain(p_job_id uuid,p_owner_id uuid,p_request_id text,p_error text) returns void language plpgsql security definer set search_path=public as $$
declare v_chunk_id uuid;
begin
 if auth.role()<>'service_role' then raise exception 'service_role required'; end if;
 update public.shopling_price_bulk_chunks c set status='dispatch_uncertain',last_error=left(coalesce(p_error,'dispatch uncertain'),1000),updated_at=now() from public.shopling_price_bulk_jobs j where c.job_id=j.id and j.id=p_job_id and j.owner_id=p_owner_id and c.chunk_type='normal' and c.request_id=p_request_id and c.status in ('dispatching','running') returning c.id into v_chunk_id;
 if v_chunk_id is null then raise exception 'invalid normal uncertain transition'; end if;
 update public.shopling_price_bulk_jobs set status='dispatch_uncertain',last_error=left(coalesce(p_error,'dispatch uncertain'),1000),updated_at=now() where id=p_job_id and owner_id=p_owner_id;
end $$;

create or replace function public.finish_shopling_price_bulk_normal_chunk(p_job_id uuid,p_owner_id uuid,p_request_id text,p_success boolean,p_failure_scope_known boolean,p_failed_keys text[],p_summary jsonb,p_run_url text,p_error text) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_chunk public.shopling_price_bulk_chunks; v_failed text[]:=coalesce(p_failed_keys,array[]::text[]); v_remaining int;
begin
 if auth.role()<>'service_role' then raise exception 'service_role required'; end if;
 select c.* into v_chunk from public.shopling_price_bulk_chunks c join public.shopling_price_bulk_jobs j on j.id=c.job_id where c.job_id=p_job_id and j.owner_id=p_owner_id and c.chunk_type='normal' and c.request_id=p_request_id and c.status in ('dispatching','running','dispatch_uncertain') for update of c;
 if v_chunk.id is null then raise exception 'normal result transition not allowed'; end if;
 if exists(select 1 from unnest(v_failed) k where not exists(select 1 from jsonb_array_elements_text(v_chunk.goods_keys) as x(value) where x.value=k)) then raise exception 'failed key outside chunk'; end if;
 if p_success and cardinality(v_failed)>0 then raise exception 'success cannot include failed keys'; end if;
 if p_success or p_failure_scope_known then update public.shopling_price_bulk_items set status=case when p_success or not(goods_key=any(v_failed)) then 'succeeded' else 'failed' end,last_error=case when goods_key=any(v_failed) then left(coalesce(p_error,'normal failed'),1000) else null end,updated_at=now() where job_id=p_job_id and goods_key in(select jsonb_array_elements_text(v_chunk.goods_keys)); end if;
 update public.shopling_price_bulk_chunks set status=case when p_success then 'succeeded' else 'failed' end,result_summary=p_summary,actions_url=coalesce(p_run_url,actions_url),completed_at=now(),updated_at=now(),last_error=case when p_success then null else left(coalesce(p_error,'normal failed'),1000) end where id=v_chunk.id;
 select count(*) into v_remaining from public.shopling_price_bulk_chunks where job_id=p_job_id and chunk_type='normal' and status='pending';
 update public.shopling_price_bulk_jobs set status=case when not p_success then 'normal_failed' when v_remaining=0 then 'normal_succeeded' else 'normal_running' end,updated_at=now(),last_error=case when p_success then null else left(coalesce(p_error,'normal failed'),1000) end where id=p_job_id;
 return jsonb_build_object('status',case when not p_success then 'normal_failed' when v_remaining=0 then 'normal_succeeded' else 'normal_running' end,'remaining_chunk_count',v_remaining,'chunk_index',v_chunk.chunk_index);
end $$;

revoke all on function public.approve_shopling_price_bulk_normal_execution(uuid,uuid) from public,anon,authenticated;
revoke all on function public.reserve_next_shopling_price_bulk_normal_chunk(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.mark_shopling_price_bulk_normal_running(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.fail_shopling_price_bulk_normal_dispatch_rejected(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.block_shopling_price_bulk_normal_uncertain(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.finish_shopling_price_bulk_normal_chunk(uuid,uuid,text,boolean,boolean,text[],jsonb,text,text) from public,anon,authenticated;
grant execute on function public.approve_shopling_price_bulk_normal_execution(uuid,uuid) to service_role;
grant execute on function public.reserve_next_shopling_price_bulk_normal_chunk(uuid,uuid,text) to service_role;
grant execute on function public.mark_shopling_price_bulk_normal_running(uuid,uuid,text,text) to service_role;
grant execute on function public.fail_shopling_price_bulk_normal_dispatch_rejected(uuid,uuid,text,text) to service_role;
grant execute on function public.block_shopling_price_bulk_normal_uncertain(uuid,uuid,text,text) to service_role;
grant execute on function public.finish_shopling_price_bulk_normal_chunk(uuid,uuid,text,boolean,boolean,text[],jsonb,text,text) to service_role;
