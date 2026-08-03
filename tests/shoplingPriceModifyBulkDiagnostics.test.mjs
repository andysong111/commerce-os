import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const { normalErrorDetail } = await importTranspiledTypeScript(
  new URL("../src/lib/shoplingPriceModifyBulkError.ts", import.meta.url),
);
const { buildShoplingPriceBulkHealth } = await importTranspiledTypeScript(
  new URL("../src/lib/shoplingPriceModifyBulkHealth.ts", import.meta.url),
);


test("normal diagnostics serialize objects and redact Supabase credentials", () => {
  const detail = normalErrorDetail({ message: "Authorization: Bearer eyJabc.def.ghi apikey=sb_secret_private service role key" });
  assert.match(detail, /Authorization: \[REDACTED\]/);
  assert.doesNotMatch(detail, /eyJabc|sb_secret_private/);
  assert.equal(normalErrorDetail({ reason: "safe context" }), '{"reason":"safe context"}');
  assert.equal(normalErrorDetail(new Error("safe error")), "safe error");
});

test("Bulk API returns safe copyable diagnostics and redacts secrets", async () => {
  const route = await readFile(new URL("../src/app/api/shopling-price-modify/bulk/jobs/route.ts", import.meta.url), "utf8");
  assert.match(route, /diagnostic_id/);
  assert.match(route, /BULK_PREPARED_JOB_RPC_FAILED/);
  assert.match(route, /create\.rpc\.create_shopling_price_bulk_prepared_job/);
  assert.match(route, /detail: error/);
  assert.match(route, /REDACTED_SUPABASE_SECRET/);
  assert.match(route, /REDACTED_JWT/);
});

test("Bulk UI shows a read-only diagnostic box and one-click copy button", async () => {
  const [preview, panel, client] = await Promise.all([
    readFile(new URL("../src/components/shopling-price-modify-runner/ShoplingPriceModifyBulkInputPreview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/shopling-price-modify-runner/ShoplingPriceModifyBulkErrorPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/shoplingPriceModifyBulkClient.ts", import.meta.url), "utf8"),
  ]);
  assert.match(preview, /ShoplingPriceModifyBulkErrorPanel/);
  assert.match(preview, /errorDetail/);
  assert.match(panel, /복사 가능한 오류 상세/);
  assert.match(panel, /오류 내용 복사/);
  assert.match(panel, /navigator\.clipboard\.writeText/);
  assert.match(panel, /readOnly/);
  assert.match(client, /http_status/);
  assert.match(client, /api_stage/);
  assert.match(client, /diagnostic_id/);
});

test("one-click runner exposes precise loading, elapsed time, and copyable job diagnostics", async () => {
  const [monitor, route, page, cron, guard] = await Promise.all([
    readFile(new URL("../src/components/shopling-price-modify-runner/ShoplingPriceModifyJobDiagnostics.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/shopling-price-modify/bulk/jobs/[jobId]/diagnostics/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/shopling-price-modify-runner/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/cron/shopling-price-bulk-auto/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/shoplingPriceModifyBulkStallGuard.ts", import.meta.url), "utf8"),
  ]);
  assert.match(monitor, /정밀 상태 확인/);
  assert.match(monitor, /확인 중\.\.\./);
  assert.match(monitor, /진단정보 복사/);
  assert.match(monitor, /AbortController/);
  assert.match(monitor, /15_000/);
  assert.match(monitor, /현재 묶음 경과/);
  assert.match(monitor, /요청번호/);
  assert.match(monitor, /GitHub 실행 화면 열기/);
  assert.match(route, /normalSession\(request\)/);
  assert.match(route, /buildShoplingPriceBulkHealth/);
  assert.match(route, /current_active_chunk/);
  assert.match(route, /recent_chunks/);
  assert.match(page, /ShoplingPriceModifyJobDiagnostics/);
  assert.match(cron, /stopStalledShoplingPriceBulkAutoJob/);
  assert.match(guard, /block_shopling_price_bulk_normal_uncertain/);
  assert.match(guard, /stop_shopling_price_bulk_auto_job/);
});

test("health classifier warns at ten minutes and safely stops at thirty minutes", () => {
  const now = Date.parse("2026-08-03T06:00:00.000Z");
  const job = {
    status: "normal_running",
    automation_last_tick_at: "2026-08-03T05:59:30.000Z",
    updated_at: "2026-08-03T05:59:30.000Z",
  };
  const delayed = buildShoplingPriceBulkHealth(job, {
    status: "running",
    started_at: "2026-08-03T05:49:00.000Z",
    updated_at: "2026-08-03T05:59:00.000Z",
  }, now);
  assert.equal(delayed.code, "ACTIVE_CHUNK_DELAYED");
  assert.equal(delayed.should_stop_automation, false);

  const stalled = buildShoplingPriceBulkHealth(job, {
    status: "running",
    started_at: "2026-08-03T05:29:00.000Z",
    updated_at: "2026-08-03T05:59:00.000Z",
  }, now);
  assert.equal(stalled.code, "ACTIVE_CHUNK_STALLED");
  assert.equal(stalled.should_stop_automation, true);
  assert.equal(stalled.active_chunk_age_seconds, 31 * 60);
});
