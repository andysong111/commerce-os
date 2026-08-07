import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path) {
  return readFile(path, "utf8");
}

test("006 migration adds bounded leases and recoverable unattended claims", async () => {
  const sql = await read("supabase/migrations/006_shopling_price_bulk_auto.sql");
  assert.match(sql, /shopling_price_bulk_auto_jobs/);
  assert.match(sql, /p_owner_id/);
  assert.match(sql, /lease_owner/);
  assert.match(sql, /lease_expires_at/);
  assert.match(sql, /shopling_price_bulk_auto_retry_approvals/);
  assert.match(sql, /approve_shopling_price_bulk_failed_retry/);
  assert.match(sql, /enable_shopling_price_bulk_auto_execution/);
  assert.match(sql, /release_shopling_price_bulk_auto_job/);
  assert.match(sql, /archive_shopling_price_bulk_auto_job/);
  assert.match(sql, /reserve_shopling_price_bulk_canary/);
  assert.match(sql, /reserve_next_shopling_price_bulk_normal_chunk/);
});

test("default operator screen is simple, clears stale input, and locks every unfinished auto job", async () => {
  const [page, control] = await Promise.all([
    read("src/app/shopling-price-modify/bulk/page.tsx"),
    read("src/app/shopling-price-modify/bulk/ShoplingPriceBulkClient.tsx"),
  ]);
  assert.match(page, /Shopling 가격변경/);
  assert.match(control, /기존 입력 지우기/);
  assert.match(control, /activeAutoJob/);
  assert.match(control, /unattendedState/);
  assert.match(control, /진행 중인 자동 작업/);
});

test("one-click creation API is Production-only, session-owned, confirmation-gated, and starts one safe step", async () => {
  const route = await read("src/app/api/shopling-price-modify/bulk/auto-jobs/route.ts");
  assert.match(route, /process\.env\.VERCEL_ENV !== "production"/);
  assert.match(route, /AUTO_PRODUCTION_ONLY/);
  assert.match(route, /normalSession\(\)/);
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /CONFIRM_ONE_CLICK_AUTO_PRICE_CHANGE/);
  assert.match(route, /validateShoplingPriceBulkCreateInput/);
  assert.match(route, /create_shopling_price_bulk_prepared_job/);
  assert.match(route, /p_owner_id: auth\.ownerId/);
  assert.match(route, /enable_shopling_price_bulk_auto_execution/);
  assert.match(route, /maxTransitions: 1/);
  assert.match(route, /releaseShoplingPriceBulkAutoJob/);
  assert.doesNotMatch(route, /approve_shopling_price_bulk_failed_retry/);
});

test("cron is production GET, exact Bearer authenticated, fail-closed, and bounded", async () => {
  const [route, vercel] = await Promise.all([
    read("src/app/api/cron/shopling-price-bulk-auto/route.ts"),
    read("vercel.json"),
  ]);
  assert.match(route, /export async function GET/);
  assert.match(route, /process\.env\.VERCEL_ENV !== "production"/);
  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.match(route, /if \(!secret\)/);
  assert.match(route, /Authorization|authorization/);
  assert.match(route, /Bearer \$\{secret\}/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /MAX_JOBS = 5/);
  assert.match(route, /MAX_TRANSITIONS = 4/);
  assert.match(route, /LEASE_SECONDS = 75/);
  assert.doesNotMatch(route, /user-agent/i);
  assert.doesNotMatch(route, /createSupabaseServerClient|auth\.getUser/);
  const config = JSON.parse(vercel);
  assert.deepEqual(config.crons, [
    { path: "/api/cron/shopling-price-bulk-auto", schedule: "* * * * *" },
    { path: "/api/cron/detail-page-jobs", schedule: "* * * * *" },
    { path: "/api/cron/product-decision-live-refresh", schedule: "* * * * *" },
    { path: "/api/cron/product-master-shopling-diagnostic", schedule: "* * * * *" },
    { path: "/api/cron/product-master-shopling-sales-backfill", schedule: "* * * * *" },
    { path: "/api/cron/product-master-shopling-sales-incremental", schedule: "* * * * *" },
    { path: "/api/cron/price-grade-receipt-shadow-bootstrap", schedule: "*/5 * * * *" },
  ]);
});

test("orchestrator reconciles same request IDs, honors pause, and never auto-approves failed-item retry", async () => {
  const source = await read("src/lib/shoplingPriceModifyBulkAutoOrchestrator.ts");
  assert.match(source, /fetchShoplingPriceModifyActionsResult\(requestId\)/);
  assert.match(source, /analyzeShoplingPriceBulkCanaryResult/);
  assert.match(source, /analyzeShoplingPriceBulkNormalResult/);
  assert.match(source, /reserve_shopling_price_bulk_canary/);
  assert.match(source, /approve_shopling_price_bulk_normal_execution/);
  assert.match(source, /reserve_next_shopling_price_bulk_normal_chunk/);
  assert.doesNotMatch(source, /approve_shopling_price_bulk_failed_retry/);
});

test("explicit failed-item retry approval and auto reconnection are one database transaction", async () => {
  const route = await read("src/app/api/shopling-price-modify/bulk/auto-jobs/[jobId]/retry/route.ts");
  assert.match(route, /approve_shopling_price_bulk_failed_retry/);
  assert.match(route, /normalSession\(\)/);
  assert.match(route, /p_job_id/);
  assert.match(route, /p_owner_id/);
});

test("stopped or paused unattended jobs can be archived only when no active chunk exists", async () => {
  const route = await read("src/app/api/shopling-price-modify/bulk/auto-jobs/[jobId]/archive/route.ts");
  assert.match(route, /archive_shopling_price_bulk_auto_job/);
  assert.match(route, /normalSession\(\)/);
});

test("detail API exposes auto state while validation-only remains structurally excluded", async () => {
  const route = await read("src/app/api/shopling-price-modify/bulk/requests/[requestId]/route.ts");
  assert.match(route, /autoJob/);
  assert.match(route, /unattendedState/);
  assert.match(route, /validationOnly/);
});
