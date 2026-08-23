begin;

create or replace function public.refresh_reliability_improvement_measurements()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.reliability_improvements%rowtype;
  v_duration interval;
  v_baseline_start timestamptz;
  v_baseline_end timestamptz;
  v_current_start timestamptz;
  v_current_end timestamptz;
  v_baseline_events bigint;
  v_baseline_failures bigint;
  v_baseline_recoveries bigint;
  v_current_events bigint;
  v_current_failures bigint;
  v_current_recoveries bigint;
  v_baseline_rate numeric;
  v_current_rate numeric;
  v_current_recovery_rate numeric;
  v_improvement_percent numeric;
  v_measurement_result text;
  v_next_status text;
  v_processed integer := 0;
  v_verified integer := 0;
  v_regressed integer := 0;
  v_measuring integer := 0;
begin
  for r in
    select *
    from public.reliability_improvements
    where applied_at is not null
      and status in ('policy_active','applied','measuring','verified','neutral','regressed')
    order by applied_at asc
  loop
    v_duration := least(
      interval '7 days',
      greatest(interval '1 hour', now() - r.applied_at)
    );
    v_baseline_start := r.applied_at - v_duration;
    v_baseline_end := r.applied_at;
    v_current_start := r.applied_at;
    v_current_end := least(now(), r.applied_at + v_duration);

    select
      count(distinct coalesce(e.run_id, e.id::text)),
      count(distinct coalesce(e.run_id, e.id::text)) filter (
        where e.status in ('failed','blocked','retrying','quality_rejected')
          and (r.error_code is null or e.error_code = r.error_code)
      ),
      count(distinct coalesce(e.run_id, e.id::text)) filter (
        where e.status = 'recovered'
          and (r.error_code is null or e.error_code = r.error_code)
      )
    into v_baseline_events, v_baseline_failures, v_baseline_recoveries
    from public.reliability_events e
    where e.source_system = r.source_system
      and e.engine = r.engine
      and e.occurred_at >= v_baseline_start
      and e.occurred_at < v_baseline_end;

    select
      count(distinct coalesce(e.run_id, e.id::text)),
      count(distinct coalesce(e.run_id, e.id::text)) filter (
        where e.status in ('failed','blocked','retrying','quality_rejected')
          and (r.error_code is null or e.error_code = r.error_code)
      ),
      count(distinct coalesce(e.run_id, e.id::text)) filter (
        where e.status = 'recovered'
          and (r.error_code is null or e.error_code = r.error_code)
      )
    into v_current_events, v_current_failures, v_current_recoveries
    from public.reliability_events e
    where e.source_system = r.source_system
      and e.engine = r.engine
      and e.occurred_at >= v_current_start
      and e.occurred_at <= v_current_end;

    v_baseline_rate := case
      when v_baseline_events > 0
        then v_baseline_failures::numeric / v_baseline_events::numeric
      else null
    end;
    v_current_rate := case
      when v_current_events > 0
        then v_current_failures::numeric / v_current_events::numeric
      else null
    end;
    v_current_recovery_rate := case
      when v_current_failures > 0
        then least(1, v_current_recoveries::numeric / v_current_failures::numeric)
      when v_current_events > 0 then 0
      else null
    end;

    if v_duration < interval '24 hours'
       or v_baseline_events < 5
       or v_current_events < 5
       or v_baseline_failures < 1
       or v_baseline_rate is null
       or v_current_rate is null then
      v_improvement_percent := null;
      v_measurement_result := 'insufficient_data';
      v_next_status := 'measuring';
      v_measuring := v_measuring + 1;
    else
      v_improvement_percent := round(
        ((v_baseline_rate - v_current_rate) / nullif(v_baseline_rate, 0)) * 100,
        2
      );
      if v_improvement_percent >= 20 then
        v_measurement_result := 'improved';
        v_next_status := 'verified';
        v_verified := v_verified + 1;
      elsif v_improvement_percent <= -20 then
        v_measurement_result := 'regressed';
        v_next_status := 'regressed';
        v_regressed := v_regressed + 1;
      else
        v_measurement_result := 'unchanged';
        v_next_status := 'neutral';
      end if;
    end if;

    update public.reliability_improvements
    set baseline_started_at = v_baseline_start,
        baseline_ended_at = v_baseline_end,
        current_started_at = v_current_start,
        current_ended_at = v_current_end,
        baseline_events = v_baseline_events,
        baseline_failures = v_baseline_failures,
        baseline_recoveries = v_baseline_recoveries,
        current_events = v_current_events,
        current_failures = v_current_failures,
        current_recoveries = v_current_recoveries,
        baseline_failure_rate = v_baseline_rate,
        current_failure_rate = v_current_rate,
        current_recovery_rate = v_current_recovery_rate,
        improvement_percent = v_improvement_percent,
        measurement_result = v_measurement_result,
        status = v_next_status,
        last_measured_at = now(),
        metadata = metadata || jsonb_build_object(
          'measurementWindowHours', round(extract(epoch from v_duration) / 3600.0, 2),
          'measurementMethod', 'distinct-run failure rate before versus after application'
        ),
        updated_at = now()
    where id = r.id;

    if r.measurement_result is distinct from v_measurement_result then
      insert into public.reliability_improvement_activity(
        improvement_id,
        event_type,
        from_status,
        to_status,
        summary,
        metadata
      ) values (
        r.id,
        'measurement_updated',
        r.status,
        v_next_status,
        case v_measurement_result
          when 'improved' then '적용 전보다 동일 오류 실행 비율이 20% 이상 낮아졌습니다.'
          when 'regressed' then '적용 전보다 동일 오류 실행 비율이 20% 이상 높아져 재검토가 필요합니다.'
          when 'unchanged' then '적용 전후 차이가 아직 유의미하지 않습니다.'
          else '공정한 전후 비교를 위한 실행 표본을 더 수집하고 있습니다.'
        end,
        jsonb_strip_nulls(jsonb_build_object(
          'baselineEvents', v_baseline_events,
          'baselineFailures', v_baseline_failures,
          'currentEvents', v_current_events,
          'currentFailures', v_current_failures,
          'currentRecoveries', v_current_recoveries,
          'improvementPercent', v_improvement_percent
        ))
      );
    end if;

    v_processed := v_processed + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'processed', v_processed,
    'verified', v_verified,
    'regressed', v_regressed,
    'measuring', v_measuring,
    'measuredAt', now()
  );
end;
$$;

revoke all on function public.refresh_reliability_improvement_measurements()
  from public, anon, authenticated;
grant execute on function public.refresh_reliability_improvement_measurements()
  to service_role;

select public.refresh_reliability_improvement_measurements();

comment on function public.refresh_reliability_improvement_measurements() is
  'Compares distinct-run failure rates before and after a real policy or code application; insufficient samples remain explicitly measuring.';

commit;
