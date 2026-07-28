import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("all dispatch paths have a 20-second abort deadline", async () => {
  const [canary, normal, retry] = await Promise.all([
    read("src/lib/shoplingPriceModifyBulkCanary.ts"),
    read("src/lib/shoplingPriceModifyBulkNormal.ts"),
    read("src/lib/shoplingPriceModifyBulkRetry.ts"),
  ]);

  assert.match(canary, /signal\?: AbortSignal/);
  assert.match(normal, /signal\?: AbortSignal/);
  assert.match(retry, /signal\?: AbortSignal/);
  assert.match(canary, /const dispatchSignal = signal \?\? AbortSignal\.timeout\(20_000\)/);
  assert.match(normal, /const dispatchSignal = signal \?\? AbortSignal\.timeout\(20_000\)/);
  assert.match(canary, /signal: dispatchSignal/);
  assert.match(normal, /signal: dispatchSignal/);
  assert.match(retry, /dispatchShoplingPriceBulkNormal\(goodsKeys, policyOverrides, requestId, signal\)/);
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

test("rejected canary reset records the auto stop marker atomically", async () => {
  const [orchestrator, sql] = await Promise.all([
    read("src/lib/shoplingPriceModifyBulkAutoOrchestrator.ts"),
    read("supabase/migrations/202607280003_shopling_price_bulk_one_click_auto_safety.sql"),
  ]);

  assert.match(sql, /create or replace function public\.reset_shopling_price_bulk_canary_rejected/);
  assert.match(sql, /set status = 'pending',[\s\S]*?request_id = null/);
  assert.match(sql, /set status = 'prepared',[\s\S]*?automation_stop_reason = case/);
  assert.match(sql, /when v_job\.automation_mode = 'auto'/);
  assert.match(orchestrator, /reset_shopling_price_bulk_canary_rejected/);
});

test("stopped terminal jobs recover the missing finish marker without dispatch", async () => {
  const sql = await read("supabase/migrations/202607280003_shopling_price_bulk_one_click_auto_safety.sql");

  assert.match(sql, /job\.status = 'normal_succeeded'/);
  assert.match(sql, /job\.status = 'canary_succeeded'[\s\S]*?not exists \([\s\S]*?chunk_type = 'normal'/);
  assert.match(sql, /if v_job\.status = 'normal_succeeded' or v_canary_only_complete then/);
  assert.match(sql, /automation_finished_at = coalesce\(automation_finished_at, now\(\)\)/);
  assert.match(sql, /'claimed', false,[\s\S]*?'finished', true/);
});
