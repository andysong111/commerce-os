-- Keep the Supabase-side SEO wakeup only as a low-frequency fallback.
-- Vercel already runs /api/cron/seo-run-worker every minute. The previous
-- pg_cron job also woke the public endpoint every minute and allowed pg_net to
-- wait up to 280 seconds, which could overlap during a Supabase slowdown and
-- amplify connection/statement timeouts across unrelated Ops Center reads.
--
-- Primary worker: Vercel every minute.
-- Fallback worker: Supabase every 5 minutes, fail-fast after 15 seconds.

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'commerce-os-seo-run-wakeup'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'commerce-os-seo-run-wakeup',
    '*/5 * * * *',
    $cron$
      select net.http_get(
        url := 'https://commerce-os-ops-center.vercel.app/api/seo-run-wakeup',
        timeout_milliseconds := 15000
      );
    $cron$
  );
end;
$$;
