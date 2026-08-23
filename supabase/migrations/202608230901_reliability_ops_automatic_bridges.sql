begin;

create or replace function public.map_reliability_status(raw_status text)
returns text language sql immutable as $$
  select case lower(coalesce(raw_status,''))
    when 'success' then 'succeeded'
    when 'succeeded' then 'succeeded'
    when 'complete' then 'succeeded'
    when 'completed' then 'succeeded'
    when 'ready' then 'succeeded'
    when 'passed' then 'succeeded'
    when 'failed' then 'failed'
    when 'error' then 'failed'
    when 'blocked' then 'blocked'
    when 'approval_required' then 'blocked'
    when 'review_required' then 'blocked'
    when 'quality_review_required' then 'quality_rejected'
    when 'retrying' then 'retrying'
    when 'retry_pending' then 'retrying'
    when 'queued' then 'started'
    when 'pending' then 'started'
    when 'running' then 'progress'
    when 'processing' then 'progress'
    when 'in_progress' then 'progress'
    when 'canceled' then 'canceled'
    when 'cancelled' then 'canceled'
    else 'progress'
  end;
$$;

create or replace function public.safe_reliability_risk(raw_risk text)
returns text language sql immutable as $$
  select case lower(coalesce(raw_risk,''))
    when 'critical' then 'critical'
    when 'high' then 'high'
    when 'medium' then 'medium'
    else 'low'
  end;
$$;

create or replace function public.bridge_commerce_operation_run_to_reliability()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_status text := public.map_reliability_status(new.status);
  v_error_code text := coalesce(
    nullif(new.result_snapshot->>'errorCode',''),
    nullif(new.result_snapshot->>'error_code',''),
    nullif(new.input_snapshot->>'errorCode',''),
    case when new.status='FAILED' then 'operation_failed' else null end
  );
  v_stage text := coalesce(nullif(new.result_snapshot->>'stage',''),nullif(new.input_snapshot->>'stage',''));
  v_signature text := case when v_status in ('failed','blocked','quality_rejected','retrying')
    then concat('commerce-operation:',new.operation_type,':',coalesce(v_error_code,lower(new.status))) else null end;
  v_event_id text := concat('commerce-operation:',new.id::text,':',
    floor(extract(epoch from coalesce(new.updated_at,now()))*1000000)::bigint::text,':',lower(new.status));
begin
  perform public.ingest_reliability_event(jsonb_build_object(
    'event_id',v_event_id,
    'source_system','commerce-os',
    'engine',new.operation_type,
    'event_type','commerce_operation.status',
    'status',v_status,
    'severity',case when v_status='failed' then 'error' when v_status in ('blocked','quality_rejected','retrying') then 'warning' else 'info' end,
    'risk_level',public.safe_reliability_risk(coalesce(new.result_snapshot->>'riskLevel',new.input_snapshot->>'riskLevel')),
    'run_id',new.id::text,
    'correlation_id',new.correlation_id,
    'incident_signature',v_signature,
    'stage',v_stage,
    'error_code',v_error_code,
    'error_message',case when v_status in ('failed','blocked','quality_rejected','retrying') then left(coalesce(new.error_message,''),2000) else null end,
    'duration_ms',case when new.finished_at is not null then greatest(0,floor(extract(epoch from (new.finished_at-new.started_at))*1000)::bigint) else null end,
    'retry_count',0,
    'automatic_recovery',false,
    'metrics',jsonb_build_object('operationStatus',new.status),
    'metadata',jsonb_build_object('source',new.source,'actorType',new.actor_type),
    'occurred_at',coalesce(new.finished_at,new.updated_at,new.started_at,now())
  ));
  return new;
end;
$$;

drop trigger if exists bridge_commerce_operation_run_to_reliability on public.commerce_operation_runs;
create trigger bridge_commerce_operation_run_to_reliability
after insert or update of status,error_message,result_snapshot on public.commerce_operation_runs
for each row execute function public.bridge_commerce_operation_run_to_reliability();

create or replace function public.bridge_keyword_stage_to_reliability()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_status text := case when lower(coalesce(new.review_status,'')) in ('rejected','failed')
    then 'quality_rejected' else public.map_reliability_status(new.run_status) end;
  v_error_code text := coalesce(
    nullif(new.output_payload->>'errorCode',''),
    nullif(new.output_payload->>'error_code',''),
    case when nullif(new.error_message,'') is not null then 'keyword_stage_failed' else null end
  );
  v_signature text := case when v_status in ('failed','blocked','quality_rejected','retrying')
    then concat('keyword-engine:',new.stage_key,':',coalesce(v_error_code,v_status)) else null end;
  v_event_id text := concat('keyword-stage:',new.goods_key,':',new.stage_key,':',
    floor(extract(epoch from coalesce(new.updated_at,new.created_at,now()))*1000000)::bigint::text,':',
    lower(coalesce(new.run_status,'unknown')),':',lower(coalesce(new.review_status,'none')));
begin
  perform public.ingest_reliability_event(jsonb_build_object(
    'event_id',v_event_id,
    'source_system','commerce-os',
    'engine','keyword-engine-elon-lab',
    'event_type','keyword_stage.status',
    'status',v_status,
    'severity',case when v_status='failed' then 'error' when v_status in ('quality_rejected','blocked','retrying') then 'warning' else 'info' end,
    'risk_level','low',
    'run_id',concat(new.goods_key,':',new.stage_key),
    'correlation_id',new.goods_key,
    'incident_signature',v_signature,
    'stage',new.stage_key,
    'error_code',v_error_code,
    'error_message',case when v_status in ('failed','quality_rejected','blocked','retrying') then left(coalesce(new.error_message,new.review_note,''),2000) else null end,
    'quality_signals',jsonb_strip_nulls(jsonb_build_object(
      'reviewStatus',nullif(new.review_status,''),
      'candidateCount',case when jsonb_typeof(new.output_payload->'candidateCount')='number' then new.output_payload->'candidateCount' else null end,
      'acceptedCount',case when jsonb_typeof(new.output_payload->'acceptedCount')='number' then new.output_payload->'acceptedCount' else null end
    )),
    'metrics',jsonb_build_object('stageIndex',new.stage_index),
    'metadata',jsonb_build_object('engineRevision',new.engine_revision),
    'occurred_at',coalesce(new.updated_at,new.created_at,now())
  ));
  return new;
end;
$$;

drop trigger if exists bridge_keyword_stage_to_reliability on public.keyword_engine_elon_lab_stage_results;
create trigger bridge_keyword_stage_to_reliability
after insert or update of run_status,review_status,error_message on public.keyword_engine_elon_lab_stage_results
for each row execute function public.bridge_keyword_stage_to_reliability();

create or replace function public.bridge_product_launch_upload_to_reliability()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_status text := public.map_reliability_status(new.status);
  v_error_code text := coalesce(
    nullif(new.result->>'errorCode',''),nullif(new.result->>'error_code',''),
    case when v_status='failed' then 'product_launch_upload_failed' else null end
  );
  v_signature text := case when v_status in ('failed','blocked','quality_rejected','retrying')
    then concat('product-launch-upload:',coalesce(v_error_code,v_status)) else null end;
  v_event_id text := concat('product-launch-upload:',new.id::text,':',
    floor(extract(epoch from coalesce(new.updated_at,new.created_at,now()))*1000000)::bigint::text,':',
    lower(coalesce(new.status,'unknown')));
begin
  perform public.ingest_reliability_event(jsonb_build_object(
    'event_id',v_event_id,
    'source_system','commerce-os',
    'engine','product-launch-upload',
    'event_type','product_launch_upload.status',
    'status',v_status,
    'severity',case when v_status='failed' then 'error' when v_status in ('blocked','quality_rejected','retrying') then 'warning' else 'info' end,
    'risk_level','medium',
    'run_id',new.id::text,
    'correlation_id',coalesce(nullif(new.request_id,''),new.id::text),
    'incident_signature',v_signature,
    'stage','shopling_upload',
    'error_code',v_error_code,
    'error_message',case when v_status in ('failed','blocked','quality_rejected','retrying') then left(coalesce(new.error_message,''),2000) else null end,
    'duration_ms',case when new.completed_at is not null then greatest(0,floor(extract(epoch from (new.completed_at-new.created_at))*1000)::bigint) else null end,
    'metadata',jsonb_build_object('launchItemId',new.launch_item_id),
    'occurred_at',coalesce(new.completed_at,new.updated_at,new.created_at,now())
  ));
  return new;
end;
$$;

drop trigger if exists bridge_product_launch_upload_to_reliability on public.product_launch_upload_jobs;
create trigger bridge_product_launch_upload_to_reliability
after insert or update of status,error_message,result on public.product_launch_upload_jobs
for each row execute function public.bridge_product_launch_upload_to_reliability();

create or replace function public.bridge_seo_dispatch_to_reliability()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_status text := public.map_reliability_status(new.status);
  v_error_code text := coalesce(
    nullif(new.result_payload->>'errorCode',''),nullif(new.result_payload->>'error_code',''),
    case when v_status='failed' then 'seo_title_dispatch_failed' else null end
  );
  v_signature text := case when v_status in ('failed','blocked','quality_rejected','retrying')
    then concat('seo-title-dispatch:',new.dispatch_kind,':',coalesce(v_error_code,v_status)) else null end;
  v_event_id text := concat('seo-title-dispatch:',new.dispatch_id::text,':',
    floor(extract(epoch from coalesce(new.updated_at,new.created_at,now()))*1000000)::bigint::text,':',
    lower(coalesce(new.status,'unknown')));
begin
  perform public.ingest_reliability_event(jsonb_build_object(
    'event_id',v_event_id,
    'source_system','commerce-os',
    'engine','seo-title-cloud-shopling',
    'event_type','seo_title_dispatch.status',
    'status',v_status,
    'severity',case when v_status='failed' then 'error' when v_status in ('blocked','quality_rejected','retrying') then 'warning' else 'info' end,
    'risk_level','medium',
    'run_id',new.dispatch_id::text,
    'correlation_id',coalesce(nullif(new.external_request_id,''),new.dispatch_id::text),
    'incident_signature',v_signature,
    'stage',new.dispatch_kind,
    'error_code',v_error_code,
    'error_message',case when v_status in ('failed','blocked','quality_rejected','retrying') then left(coalesce(new.result_payload->>'errorMessage',new.result_payload->>'message',''),2000) else null end,
    'metrics',jsonb_build_object(
      'registrationRounds',new.registration_rounds,
      'requestedTitleCount',new.requested_title_count,
      'reservedTitleCount',new.reserved_title_count
    ),
    'metadata',jsonb_build_object('dispatchKind',new.dispatch_kind,'launchItemId',new.launch_item_id),
    'occurred_at',coalesce(new.completed_at,new.updated_at,new.created_at,now())
  ));
  return new;
end;
$$;

drop trigger if exists bridge_seo_dispatch_to_reliability on public.seo_title_dispatches;
create trigger bridge_seo_dispatch_to_reliability
after insert or update of status,result_payload on public.seo_title_dispatches
for each row execute function public.bridge_seo_dispatch_to_reliability();

-- Privacy-minimized historical backfill. Raw payloads and user identity are excluded.
do $$
declare
  r record;
  v_status text;
  v_error_code text;
begin
  for r in select * from public.commerce_operation_runs loop
    v_status := public.map_reliability_status(r.status);
    v_error_code := coalesce(
      nullif(r.result_snapshot->>'errorCode',''),nullif(r.result_snapshot->>'error_code',''),
      case when r.status='FAILED' then 'operation_failed' else null end
    );
    perform public.ingest_reliability_event(jsonb_build_object(
      'event_id',concat('backfill:commerce-operation:',r.id::text),
      'source_system','commerce-os','engine',r.operation_type,
      'event_type','commerce_operation.backfill','status',v_status,
      'severity',case when v_status='failed' then 'error' else 'info' end,
      'risk_level',public.safe_reliability_risk(r.result_snapshot->>'riskLevel'),
      'run_id',r.id::text,'correlation_id',r.correlation_id,
      'incident_signature',case when v_status='failed' then concat('commerce-operation:',r.operation_type,':',coalesce(v_error_code,'failed')) else null end,
      'stage',coalesce(r.result_snapshot->>'stage',r.input_snapshot->>'stage'),
      'error_code',v_error_code,
      'error_message',case when v_status='failed' then left(coalesce(r.error_message,''),2000) else null end,
      'duration_ms',case when r.finished_at is not null then greatest(0,floor(extract(epoch from (r.finished_at-r.started_at))*1000)::bigint) else null end,
      'metadata',jsonb_build_object('source',r.source,'backfilled',true),
      'occurred_at',coalesce(r.finished_at,r.updated_at,r.started_at)
    ));
  end loop;

  for r in select * from public.keyword_engine_elon_lab_stage_results loop
    v_status := case when lower(coalesce(r.review_status,'')) in ('rejected','failed')
      then 'quality_rejected' else public.map_reliability_status(r.run_status) end;
    v_error_code := coalesce(
      nullif(r.output_payload->>'errorCode',''),nullif(r.output_payload->>'error_code',''),
      case when nullif(r.error_message,'') is not null then 'keyword_stage_failed' else null end
    );
    perform public.ingest_reliability_event(jsonb_build_object(
      'event_id',concat('backfill:keyword-stage:',r.goods_key,':',r.stage_key),
      'source_system','commerce-os','engine','keyword-engine-elon-lab',
      'event_type','keyword_stage.backfill','status',v_status,
      'severity',case when v_status='failed' then 'error' when v_status='quality_rejected' then 'warning' else 'info' end,
      'risk_level','low','run_id',concat(r.goods_key,':',r.stage_key),'correlation_id',r.goods_key,
      'incident_signature',case when v_status in ('failed','quality_rejected') then concat('keyword-engine:',r.stage_key,':',coalesce(v_error_code,v_status)) else null end,
      'stage',r.stage_key,'error_code',v_error_code,
      'error_message',case when v_status in ('failed','quality_rejected') then left(coalesce(r.error_message,r.review_note,''),2000) else null end,
      'metrics',jsonb_build_object('stageIndex',r.stage_index),
      'metadata',jsonb_build_object('engineRevision',r.engine_revision,'backfilled',true),
      'occurred_at',coalesce(r.updated_at,r.created_at)
    ));
  end loop;

  for r in select * from public.product_launch_upload_jobs loop
    v_status := public.map_reliability_status(r.status);
    v_error_code := coalesce(
      nullif(r.result->>'errorCode',''),nullif(r.result->>'error_code',''),
      case when v_status='failed' then 'product_launch_upload_failed' else null end
    );
    perform public.ingest_reliability_event(jsonb_build_object(
      'event_id',concat('backfill:product-launch-upload:',r.id::text),
      'source_system','commerce-os','engine','product-launch-upload',
      'event_type','product_launch_upload.backfill','status',v_status,
      'severity',case when v_status='failed' then 'error' else 'info' end,
      'risk_level','medium','run_id',r.id::text,
      'correlation_id',coalesce(nullif(r.request_id,''),r.id::text),
      'incident_signature',case when v_status='failed' then concat('product-launch-upload:',coalesce(v_error_code,'failed')) else null end,
      'stage','shopling_upload','error_code',v_error_code,
      'error_message',case when v_status='failed' then left(coalesce(r.error_message,''),2000) else null end,
      'duration_ms',case when r.completed_at is not null then greatest(0,floor(extract(epoch from (r.completed_at-r.created_at))*1000)::bigint) else null end,
      'metadata',jsonb_build_object('launchItemId',r.launch_item_id,'backfilled',true),
      'occurred_at',coalesce(r.completed_at,r.updated_at,r.created_at)
    ));
  end loop;
end;
$$;

comment on function public.bridge_commerce_operation_run_to_reliability() is 'Automatically mirrors Commerce OS operation status into the privacy-minimized reliability core.';
comment on function public.bridge_keyword_stage_to_reliability() is 'Automatically captures keyword engine stage outcomes without raw keyword payloads.';
comment on function public.bridge_product_launch_upload_to_reliability() is 'Automatically captures product launch upload outcomes without owner identity or raw payloads.';
comment on function public.bridge_seo_dispatch_to_reliability() is 'Automatically captures SEO title dispatch outcomes without raw titles or search lines.';

commit;
