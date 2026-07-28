import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("all auto dispatch paths accept a bounded abort signal", async () => {
  const [canary, normal, retry, orchestrator] = await Promise.all([
    read("src/lib/shoplingPriceModifyBulkCanary.ts"),
    read("src/lib/shoplingPriceModifyBulkNormal.ts"),
    read("src/lib/shoplingPriceModifyBulkRetry.ts"),
    read("src/lib/shoplingPriceModifyBulkAutoOrchestrator.ts"),
  ]);

  assert.match(canary, /signal\?: AbortSignal/);
  assert.match(normal, /signal\?: AbortSignal/);
  assert.match(retry, /signal\?: AbortSignal/);
  assert.match(canary, /body: JSON\.stringify\(request\.body\),\s*signal,/);
  assert.match(normal, /body: JSON\.stringify\(dispatch\.body\),\s*signal,/);
  assert.match(retry, /dispatchShoplingPriceBulkNormal\(goodsKeys, policyOverrides, requestId, signal\)/);
  assert.match(orchestrator, /AbortSignal\.timeout\(20_000\)/);
  assert.match(orchestrator, /dispatchShoplingPriceBulkCanary\([^]*?AbortSignal\.timeout\(20_000\)\)/);
  assert.match(orchestrator, /dispatchShoplingPriceBulkNormal\([^]*?AbortSignal\.timeout\(20_000\)\)/);
  assert.match(orchestrator, /dispatchShoplingPriceBulkRetry\([^]*?AbortSignal\.timeout\(20_000\)\)/);
});

test("continue after review is one atomic database call", async () => {
  const [route, sql] = await Promise.all([
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/control/continue-auto/route.ts"),
    read("supabase/migrations/202607280003_shopling_price_bulk_one_click_auto_safety.sql"),
  ]);

  assert.match(route, /rpc\("continue_shopling_price_bulk_auto_after_review"/);
  assert.doesNotMatch(route, /resume_shopling_price_bulk_execution/);
  assert.doesNotMatch(route, /resume_shopling_price_bulk_auto_execution/);
  assert.match(sql, /create or replace function public\.continue_shopling_price_bulk_auto_after_review/);
  assert.match(sql, /status = v_next_status,[\s\S]*?pause_requested = false,[\s\S]*?automation_stop_reason = null/);
  assert.match(sql, /status in \('dispatching','running','dispatch_uncertain'\)[\s\S]*?raise exception 'active chunk exists'/);
});

test("rejected canary reset and stop marker are atomic", async () => {
  const [orchestrator, sql] = await Promise.all([
    read("src/lib/shoplingPriceModifyBulkAutoOrchestrator.ts"),
    read("supabase/migrations/202607280003_shopling_price_bulk_one_click_auto_safety.sql"),
  ]);

  assert.match(sql, /create or replace function public\.reject_shopling_price_bulk_canary_auto/);
  assert.match(sql, /set status = 'pending',[\s\S]*?request_id = null/);
  assert.match(sql, /set status = 'prepared',[\s\S]*?automation_stop_reason =/);
  assert.match(orchestrator, /reject_shopling_price_bulk_canary_auto/);
  assert.doesNotMatch(orchestrator, /reset_shopling_price_bulk_canary_rejected/);
});

test("stopped terminal jobs remain claimable only for completion markers", async () => {
  const [orchestrator, sql] = await Promise.all([
    read("src/lib/shoplingPriceModifyBulkAutoOrchestrator.ts"),
    read("supabase/migrations/202607280003_shopling_price_bulk_one_click_auto_safety.sql"),
  ]);

  assert.match(sql, /job\.status = 'normal_succeeded'/);
  assert.match(sql, /job\.status = 'canary_succeeded'[\s\S]*?not exists \([\s\S]*?chunk_type = 'normal'/);
  assert.match(orchestrator, /if \(job\.status === "normal_succeeded"\) return finishAuto/);
  assert.match(orchestrator, /job\.status === "canary_succeeded"[\s\S]*?normalCount === 0[\s\S]*?finishAuto/);
  assert.match(orchestrator, /if \(stopped\)[\s\S]*?return \{ outcome: "noop"/);
});
