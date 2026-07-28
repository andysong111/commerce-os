import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("only one unfinished unattended job per owner can exist", async () => {
  const sql = await read("supabase/migrations/202607280002_shopling_price_bulk_one_click_auto.sql");
  assert.match(sql, /create unique index if not exists shopling_price_bulk_jobs_owner_active_auto_unique/);
  assert.match(sql, /on public\.shopling_price_bulk_jobs\(owner_id\)/);
  assert.match(sql, /where automation_mode = 'auto'[\s\S]*?archived_at is null[\s\S]*?automation_finished_at is null/);
  assert.match(sql, /automation_worker_id is distinct from p_worker_id/);
});

test("one-click creation is Production-only and fails before job creation when cron is missing", async () => {
  const route = await read("src/app/api/shopling-price-modify/bulk/auto-jobs/route.ts");
  const productionGuard = route.indexOf("AUTO_PRODUCTION_ONLY");
  const configGuard = route.indexOf("AUTO_CRON_CONFIG_MISSING");
  const jobCreation = route.indexOf("create_shopling_price_bulk_prepared_job");
  assert.ok(productionGuard >= 0);
  assert.ok(configGuard > productionGuard);
  assert.ok(jobCreation > configGuard);
  assert.match(route, /process\.env\.VERCEL_ENV !== "production"/);
  assert.match(route, /if \(!process\.env\.CRON_SECRET\?\.trim\(\)\)/);
  assert.match(route, /503/);
});

test("the cron worker is Production-only before secret or database access", async () => {
  const route = await read("src/app/api/cron/shopling-price-bulk-auto/route.ts");
  const productionGuard = route.indexOf('process.env.VERCEL_ENV !== "production"');
  const secretRead = route.indexOf("process.env.CRON_SECRET");
  const adminRead = route.indexOf("createSupabaseAdminClient()");
  assert.ok(productionGuard >= 0);
  assert.ok(secretRead > productionGuard);
  assert.ok(adminRead > secretRead);
  assert.match(route, /status: 403/);
});

test("a duplicate or failed pre-dispatch auto start is archived without dispatching", async () => {
  const route = await read("src/app/api/shopling-price-modify/bulk/auto-jobs/route.ts");
  assert.match(route, /shopling_price_bulk_jobs_owner_active_auto_unique/);
  assert.match(route, /AUTO_JOB_ALREADY_ACTIVE/);
  assert.match(route, /archive_shopling_price_bulk_job/);
  assert.match(route, /one-click auto enable failed before any dispatch/);
  assert.match(route, /cleanup_archived/);
  const enablePosition = route.indexOf("enable_shopling_price_bulk_auto_execution");
  const runPosition = route.lastIndexOf("runClaimedShoplingPriceBulkAutoJob(");
  assert.ok(enablePosition >= 0 && runPosition > enablePosition);
});

test("a committed final normal result can recover its missing automation finish marker", async () => {
  const [sql, orchestrator] = await Promise.all([
    read("supabase/migrations/202607280002_shopling_price_bulk_one_click_auto.sql"),
    read("src/lib/shoplingPriceModifyBulkAutoOrchestrator.ts"),
  ]);
  assert.match(sql, /job\.status in \([\s\S]*?'normal_succeeded'[\s\S]*?\)/);
  assert.match(orchestrator, /if \(job\.status === "normal_succeeded"\) return finishAuto/);
  assert.match(orchestrator, /가격 변경은 완료됐으며 완료 상태 저장을 다시 확인합니다/);
});

test("pause and stopped-active recovery never reserve a replacement request", async () => {
  const [sql, orchestrator] = await Promise.all([
    read("supabase/migrations/202607280002_shopling_price_bulk_one_click_auto.sql"),
    read("src/lib/shoplingPriceModifyBulkAutoOrchestrator.ts"),
  ]);
  assert.match(sql, /job\.automation_stop_reason is null[\s\S]*?active_chunk\.status in \('dispatching','running','dispatch_uncertain'\)/);
  assert.match(orchestrator, /if \(active\.length === 1\) return processNormalResult/);
  assert.match(orchestrator, /if \(active\.length === 1\) return processRetryResult/);
  assert.match(orchestrator, /if \(stopped\) return \{ outcome: "noop"/);
  assert.match(orchestrator, /When pause_requested is true[\s\S]*?returns without creating a dispatch/);
  assert.doesNotMatch(orchestrator, /automation_stop_reason[\s\S]{0,500}generateShoplingPriceModifyRequestId/);
});

test("failed-item retry cannot commit without clearing an auto stop reason", async () => {
  const [sql, route] = await Promise.all([
    read("supabase/migrations/202607280002_shopling_price_bulk_one_click_auto.sql"),
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/retry/approve/route.ts"),
  ]);
  assert.match(sql, /approve_shopling_price_bulk_failed_retry_auto/);
  assert.match(sql, /v_result := public\.approve_shopling_price_bulk_failed_retry/);
  assert.match(sql, /if v_auto then[\s\S]*?automation_stop_reason = null/);
  assert.match(route, /rpc\("approve_shopling_price_bulk_failed_retry_auto"/);
  assert.doesNotMatch(route, /resume_shopling_price_bulk_auto_execution/);
});
