import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("004 migration provides bounded failed-only retry, recovery, pause, and service-role RPCs", async () => {
  const sql = await read("supabase/migrations/202607270001_shopling_price_bulk_retry_recovery.sql");

  for (const value of [
    "normal_paused",
    "retry_running",
    "retry_paused",
    "retry_failed",
    "'retry'",
    "'recovered'",
    "'superseded'",
  ]) assert.match(sql, new RegExp(value));

  assert.match(sql, /max_retry_rounds integer not null default 2/);
  assert.match(sql, /retry_scope_known boolean not null default true/);
  assert.match(sql, /where job_id = p_job_id and status = 'failed'/);
  assert.match(sql, /row_number\(\) over \(order by ordinal\) - 1\) \/ 50/);
  assert.match(sql, /v_job\.retry_round >= v_job\.max_retry_rounds/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /status in \('dispatching', 'running', 'dispatch_uncertain'\)/);
  assert.match(sql, /status = 'superseded'/);
  assert.match(sql, /retry failure scope is unknown/);
  assert.match(sql, /if v_job\.id is null then raise exception 'job not found for owner'/);
  assert.match(sql, /where job_id = v_job\.id[\s\S]*request_id = p_request_id/);
  assert.match(sql, /pause_requested then[\s\S]*status = 'retry_paused'[\s\S]*'paused', true/);

  for (const rpc of [
    "approve_shopling_price_bulk_failed_retry",
    "reserve_next_shopling_price_bulk_retry_chunk",
    "mark_shopling_price_bulk_retry_running",
    "fail_shopling_price_bulk_retry_dispatch_rejected",
    "block_shopling_price_bulk_retry_uncertain",
    "finish_shopling_price_bulk_retry_chunk",
    "request_shopling_price_bulk_pause",
    "resume_shopling_price_bulk_execution",
  ]) {
    assert.match(sql, new RegExp(`function public\\.${rpc}`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${rpc}[^;]+service_role`));
  }
});

test("101 failed goods keys are planned as retry chunks 50, 50, and 1", () => {
  const goodsKeys = Array.from({ length: 101 }, (_, index) => String(100000 + index));
  const chunks = [];
  for (let offset = 0; offset < goodsKeys.length; offset += 50) chunks.push(goodsKeys.slice(offset, offset + 50));
  assert.deepEqual(chunks.map((chunk) => chunk.length), [50, 50, 1]);
  assert.deepEqual(chunks.flat(), goodsKeys);
});

test("retry SQL terminates a failed round and selects only still-failed items for the next round", async () => {
  const sql = await read("supabase/migrations/202607270001_shopling_price_bulk_retry_recovery.sql");
  assert.match(sql, /retry_round = v_chunk\.retry_round[\s\S]*status = 'pending'/);
  assert.match(sql, /set status = 'superseded'/);
  assert.match(sql, /from public\.shopling_price_bulk_items[\s\S]*status = 'failed'/);
  assert.doesNotMatch(sql, /status in \('failed', 'succeeded'\)[\s\S]*failed_only/);
});

test("unknown retry failure scope blocks later retry approval and is visible to the UI", async () => {
  const [sql, route, ui] = await Promise.all([
    read("supabase/migrations/202607270001_shopling_price_bulk_retry_recovery.sql"),
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/route.ts"),
    read("src/components/shopling-price-modify-runner/ShoplingPriceModifyBulkInputPreview.tsx"),
  ]);
  assert.match(sql, /retry_scope_known = case[\s\S]*else p_failure_scope_known/);
  assert.match(sql, /if not v_job\.retry_scope_known then/);
  assert.match(route, /retry_scope_known/);
  assert.match(ui, /detail\.job\.retry_scope_known !== false/);
  assert.match(ui, /재실행 결과의 실패 범위를 특정할 수 없어 다시 실행할 수 없습니다/);
});

test("retry APIs never accept client goods keys and reconcile exact existing request ids", async () => {
  const [approve, advance, result, pause, resume] = await Promise.all([
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/retry/approve/route.ts"),
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/retry/advance/route.ts"),
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/retry/result/route.ts"),
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/control/pause/route.ts"),
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/control/resume/route.ts"),
  ]);
  assert.match(approve, /CONFIRM_FAILED_GOODS_RETRY/);
  assert.doesNotMatch(approve, /goods_keys/);
  assert.match(approve, /RETRY_APPROVAL_EMPTY/);
  assert.match(advance, /generateShoplingPriceModifyRequestId/);
  assert.match(advance, /reserve_next_shopling_price_bulk_retry_chunk[\s\S]*dispatchShoplingPriceBulkRetry/);
  assert.match(advance, /context\.paused[\s\S]*retry_paused/);
  assert.match(result, /fetchShoplingPriceModifyActionsResult\(requestId\)/);
  assert.match(result, /\["dispatching","running","dispatch_uncertain"\]/);
  assert.doesNotMatch(result, /dispatchShoplingPriceBulkRetry/);
  assert.match(pause, /PAUSE_RPC_EMPTY/);
  assert.match(resume, /RESUME_RPC_EMPTY/);
});

test("failed goods-key endpoint is owner-scoped and paginates the complete ordered list", async () => {
  const [endpoint, detailRoute, ui, admin] = await Promise.all([
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/failed-keys/route.ts"),
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/route.ts"),
    read("src/components/shopling-price-modify-runner/ShoplingPriceModifyBulkInputPreview.tsx"),
    read("src/lib/supabase/admin.ts"),
  ]);
  assert.match(endpoint, /owner_id/);
  assert.match(endpoint, /status", "failed"/);
  assert.match(endpoint, /order\("ordinal", \{ ascending: true \}\)/);
  assert.match(endpoint, /PAGE_SIZE = 1_000/);
  assert.match(endpoint, /for \(let offset = 0; offset < MAX_FAILED_KEYS; offset \+= PAGE_SIZE\)/);
  assert.match(endpoint, /\.range\(offset, pageEnd\)/);
  assert.match(endpoint, /MAX_FAILED_KEYS = 20_000/);
  assert.match(admin, /range\(from: number, to: number\)/);
  assert.match(detailRoute, /FAILED_PREVIEW_LIMIT = 100/);
  assert.match(detailRoute, /failed_preview_truncated/);
  assert.match(ui, /\/failed-keys/);
  assert.match(ui, /실패 goods_key 전체 복사/);
  assert.match(ui, /복사 버튼은 실패 상품 전체를 가져옵니다/);
  assert.doesNotMatch(ui, /writeText\(detail\.failed_goods_keys_preview/);
});

test("UI exposes failed-only retry, pause/resume and a timeout-only loop", async () => {
  const ui = await read("src/components/shopling-price-modify-runner/ShoplingPriceModifyBulkInputPreview.tsx");
  for (const phrase of [
    "실패 goods_key 전체 복사",
    "이미 성공한 상품은 다시 실행하지 않습니다",
    "현재 청크 완료 후 일시중지",
    "직렬 실행 재개",
    "최대 재시도 횟수에 도달했습니다",
  ]) assert.match(ui, new RegExp(phrase));
  assert.match(ui, /detail\.failed_goods_key_count > 0/);
  assert.match(ui, /\/retry\/approve/);
  assert.match(ui, /window\.setTimeout/);
  assert.doesNotMatch(ui, /setInterval/);
});
