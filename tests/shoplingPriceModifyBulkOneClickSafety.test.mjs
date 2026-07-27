import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("only one active unattended job per owner can exist", async () => {
  const sql = await read("supabase/migrations/202607280002_shopling_price_bulk_one_click_auto.sql");
  assert.match(sql, /create unique index if not exists shopling_price_bulk_jobs_owner_active_auto_unique/);
  assert.match(sql, /on public\.shopling_price_bulk_jobs\(owner_id\)/);
  assert.match(sql, /where automation_mode = 'auto'[\s\S]*?archived_at is null[\s\S]*?automation_finished_at is null[\s\S]*?automation_stop_reason is null/);
  assert.match(sql, /job\.automation_stop_reason is null/);
});

test("one-click creation fails before job creation when cron is missing", async () => {
  const route = await read("src/app/api/shopling-price-modify/bulk/auto-jobs/route.ts");
  const configGuard = route.indexOf("AUTO_CRON_CONFIG_MISSING");
  const jobCreation = route.indexOf("create_shopling_price_bulk_prepared_job");
  assert.ok(configGuard >= 0);
  assert.ok(jobCreation > configGuard);
  assert.match(route, /if \(!process\.env\.CRON_SECRET\?\.trim\(\)\)/);
  assert.match(route, /503/);
});

test("a duplicate or failed pre-dispatch auto start is archived without dispatching", async () => {
  const route = await read("src/app/api/shopling-price-modify/bulk/auto-jobs/route.ts");
  assert.match(route, /shopling_price_bulk_jobs_owner_active_auto_unique/);
  assert.match(route, /AUTO_JOB_ALREADY_ACTIVE/);
  assert.match(route, /archive_shopling_price_bulk_job/);
  assert.match(route, /one-click auto enable failed before any dispatch/);
  assert.match(route, /cleanup_archived/);
  const enablePosition = route.indexOf("enable_shopling_price_bulk_auto_execution");
  const runPosition = route.indexOf("runClaimedShoplingPriceBulkAutoJob");
  assert.ok(enablePosition >= 0 && runPosition > enablePosition);
});
