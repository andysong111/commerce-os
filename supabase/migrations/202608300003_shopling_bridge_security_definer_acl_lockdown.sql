-- Lock all Shopling bridge SECURITY DEFINER RPCs to backend service_role only.
-- Supabase may retain explicit anon/authenticated EXECUTE grants even after revoking PUBLIC.

revoke all on function public.claim_shopling_market_pipeline_tasks(text, integer) from public, anon, authenticated;
revoke all on function public.arm_shopling_market_pipeline_submit(text, text) from public, anon, authenticated;
revoke all on function public.report_shopling_market_pipeline_task(text, text, text, text, text) from public, anon, authenticated;

revoke all on function public.claim_shopling_title_diversification_tasks(text, integer) from public, anon, authenticated;
revoke all on function public.report_shopling_title_diversification_task(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.retry_shopling_title_diversification_failures(integer) from public, anon, authenticated;

grant execute on function public.claim_shopling_market_pipeline_tasks(text, integer) to service_role;
grant execute on function public.arm_shopling_market_pipeline_submit(text, text) to service_role;
grant execute on function public.report_shopling_market_pipeline_task(text, text, text, text, text) to service_role;

grant execute on function public.claim_shopling_title_diversification_tasks(text, integer) to service_role;
grant execute on function public.report_shopling_title_diversification_task(text, text, text, text, text) to service_role;
grant execute on function public.retry_shopling_title_diversification_failures(integer) to service_role;
