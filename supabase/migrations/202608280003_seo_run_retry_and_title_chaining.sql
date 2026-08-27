-- Durable SEO RUN retry semantics and same-product title chaining.
-- Healthy lease reclaims / time-budget handoffs must not consume retry attempts.
-- When one RUN finishes, its titles are injected into later queued RUN exclusions.

create or replace function public.claim_next_seo_run_job(
  p_worker_id text,
  p_lease_seconds integer default 420
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.seo_run_jobs;
  v_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if v_role <> 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9._:-]{1,120}$' then
    raise exception 'invalid worker id';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 900 then
    raise exception 'lease seconds must be between 60 and 900';
  end if;

  select job.* into v_job
  from public.seo_run_jobs job
  where job.archived_at is null
    and job.status in ('queued','running')
    and job.not_before <= now()
    and job.attempt_count < job.max_attempts
    and (
      job.status = 'queued'
      or job.lease_until is null
      or job.lease_until <= now()
    )
    and not exists (
      select 1
      from public.seo_run_jobs active
      where active.owner_id = job.owner_id
        and active.launch_item_id = job.launch_item_id
        and active.run_id <> job.run_id
        and active.archived_at is null
        and active.status = 'running'
        and active.lease_until > now()
    )
  order by job.not_before asc, job.run_created_at asc, job.created_at asc
  limit 1
  for update skip locked;

  if v_job.run_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- Claiming, lease recovery, and a normal time-budget continuation are not
  -- failures. attempt_count is incremented only by the failure trigger below.
  update public.seo_run_jobs
  set status = 'running',
      lease_owner = p_worker_id,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(started_at, now()),
      error_message = '',
      updated_at = now()
  where run_id = v_job.run_id
  returning * into v_job;

  return jsonb_build_object(
    'claimed', true,
    'job', to_jsonb(v_job)
  );
end;
$$;

revoke all on function public.claim_next_seo_run_job(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_next_seo_run_job(text, integer)
  to service_role;

create or replace function public.enforce_seo_run_failure_attempts()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.status = 'running'
     and new.status in ('queued', 'failed')
     and btrim(coalesce(new.error_message, '')) <> '' then
    new.attempt_count := old.attempt_count + 1;

    if new.attempt_count >= new.max_attempts then
      new.status := 'failed';
      new.message := '자동 재시도 한도 도달 · ' ||
        coalesce(nullif(new.stage, ''), 'unknown') || ' 체크포인트 보존';
      new.completed_at := coalesce(new.completed_at, now());
      new.lease_owner := null;
      new.lease_until := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists seo_run_jobs_failure_attempts
  on public.seo_run_jobs;
create trigger seo_run_jobs_failure_attempts
before update on public.seo_run_jobs
for each row
execute function public.enforce_seo_run_failure_attempts();

create or replace function public.propagate_ready_seo_run_titles()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_titles jsonb := '[]'::jsonb;
begin
  if new.status = 'ready' and old.status is distinct from 'ready' then
    select coalesce(jsonb_agg(dedup.title order by dedup.first_ordinal), '[]'::jsonb)
      into v_titles
    from (
      select raw.title, min(raw.ordinality) as first_ordinal
      from (
        select
          btrim(entry.value ->> 'title') as title,
          entry.ordinality
        from jsonb_array_elements(
          coalesce(
            new.result_payload -> 'seoFinal' -> 'mallTitles',
            new.result_payload -> 'result' -> 'seoFinal' -> 'mallTitles',
            '[]'::jsonb
          )
        ) with ordinality as entry(value, ordinality)
      ) raw
      where raw.title <> ''
      group by raw.title
    ) dedup;

    if jsonb_array_length(v_titles) > 0 then
      update public.seo_run_jobs pending
      set input_payload = jsonb_set(
            coalesce(pending.input_payload, '{}'::jsonb),
            '{excludedMallTitles}',
            (
              select coalesce(
                jsonb_agg(unique_title.value order by unique_title.first_ordinal),
                '[]'::jsonb
              )
              from (
                select combined.value, min(combined.ordinality) as first_ordinal
                from (
                  select
                    btrim(existing.value) as value,
                    existing.ordinality
                  from jsonb_array_elements_text(
                    coalesce(
                      pending.input_payload -> 'excludedMallTitles',
                      '[]'::jsonb
                    )
                  ) with ordinality as existing(value, ordinality)

                  union all

                  select
                    btrim(added.value) as value,
                    1000000 + added.ordinality
                  from jsonb_array_elements_text(v_titles)
                    with ordinality as added(value, ordinality)
                ) combined
                where combined.value <> ''
                group by combined.value
                order by min(combined.ordinality)
                limit 1200
              ) unique_title
            ),
            true
          ),
          updated_at = now()
      where pending.owner_id = new.owner_id
        and pending.launch_item_id = new.launch_item_id
        and pending.run_id <> new.run_id
        and pending.archived_at is null
        and pending.status = 'queued';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists seo_run_jobs_propagate_ready_titles
  on public.seo_run_jobs;
create trigger seo_run_jobs_propagate_ready_titles
after update on public.seo_run_jobs
for each row
execute function public.propagate_ready_seo_run_titles();

comment on function public.enforce_seo_run_failure_attempts() is
  'Counts only actual failed stage transitions; normal checkpoint continuation does not consume retries.';
comment on function public.propagate_ready_seo_run_titles() is
  'Adds completed same-product RUN titles to later queued RUN exclusion lists before they are claimed.';
