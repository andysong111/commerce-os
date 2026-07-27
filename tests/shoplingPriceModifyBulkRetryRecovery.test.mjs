import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("004 migration provides bounded failed-only retry, recovery, and service-role RPCs", async () => {
  const sql = await read("supabase/migrations/202607270001_shopling_price_bulk_retry_recovery.sql");
  for (const value of ["normal_paused", "retry_running", "retry_paused", "retry_failed", "'retry'", "'recovered'"]) assert.match(sql, new RegExp(value));
  assert.match(sql, /max_retry_rounds integer not null default 2/);
  assert.match(sql, /where job_id=p_job_id and status='failed'/);
  assert.match(sql, /row_number\(\) over\(order by ordinal\)-1\)\/50/);
  assert.match(sql, /retry_round>=v_job\.max_retry_rounds/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /status in \('dispatching','running','dispatch_uncertain'\)/);
  for (const rpc of ["approve_shopling_price_bulk_failed_retry", "reserve_next_shopling_price_bulk_retry_chunk", "mark_shopling_price_bulk_retry_running", "fail_shopling_price_bulk_retry_dispatch_rejected", "block_shopling_price_bulk_retry_uncertain", "finish_shopling_price_bulk_retry_chunk", "request_shopling_price_bulk_pause", "resume_shopling_price_bulk_execution"]) {
    assert.match(sql, new RegExp(`function public\\.${rpc}`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${rpc}[^']*service_role`));
  }
});

test("retry APIs never accept client goods keys and reconcile exact existing request ids", async () => {
  const [approve, advance, result] = await Promise.all([
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/retry/approve/route.ts"),
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/retry/advance/route.ts"),
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/retry/result/route.ts"),
  ]);
  assert.match(approve, /CONFIRM_FAILED_GOODS_RETRY/);
  assert.doesNotMatch(approve, /goods_keys/);
  assert.match(advance, /generateShoplingPriceModifyRequestId/);
  assert.match(advance, /reserve_next_shopling_price_bulk_retry_chunk[\s\S]*dispatchShoplingPriceBulkRetry/);
  assert.match(result, /fetchShoplingPriceModifyActionsResult\(requestId\)/);
  assert.match(result, /\["dispatching","running","dispatch_uncertain"\]/);
  assert.doesNotMatch(result, /dispatchShoplingPriceBulkRetry/);
});

test("UI exposes failed-only retry, pause/resume and a timeout-only loop", async () => {
  const ui = await read("src/components/shopling-price-modify-runner/ShoplingPriceModifyBulkInputPreview.tsx");
  for (const phrase of ["실패 goods_key 복사", "이미 성공한 상품은 다시 실행하지 않습니다", "현재 청크 완료 후 일시중지", "직렬 실행 재개", "최대 재시도 횟수에 도달했습니다"]) assert.match(ui, new RegExp(phrase));
  assert.match(ui, /detail\.failed_goods_key_count > 0/);
  assert.match(ui, /\/retry\/approve/);
  assert.match(ui, /window\.setTimeout/);
  assert.doesNotMatch(ui, /setInterval/);
});
