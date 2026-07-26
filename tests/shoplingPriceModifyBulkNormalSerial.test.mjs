import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("normal serial migration owns approval, reservation, transitions and service-role grants", async () => {
  const sql = await read("supabase/migrations/202607260003_shopling_price_bulk_normal_serial.sql");
  for (const status of ["normal_running", "normal_succeeded", "normal_failed"]) assert.match(sql, new RegExp(`'${status}'`));
  for (const rpc of ["approve_shopling_price_bulk_normal_execution", "reserve_next_shopling_price_bulk_normal_chunk", "mark_shopling_price_bulk_normal_running", "fail_shopling_price_bulk_normal_dispatch_rejected", "block_shopling_price_bulk_normal_uncertain", "finish_shopling_price_bulk_normal_chunk"]) {
    assert.match(sql, new RegExp(`function public.${rpc}`));
    assert.match(sql, new RegExp(`grant execute on function public.${rpc}[^;]+service_role`));
  }
  assert.match(sql, /order by chunk_index asc limit 1 for update skip locked/);
  assert.match(sql, /status='pending' and attempt_count=0/);
  assert.match(sql, /attempt_count=attempt_count\+1/);
  assert.match(sql, /status in \('dispatching','running','dispatch_uncertain'\)/);
  assert.match(sql, /when v_remaining=0 then 'normal_succeeded'/);
  assert.equal((sql.match(/returning c\.id into v_chunk_id/g) ?? []).length, 2);
  assert.equal((sql.match(/if v_chunk_id is null then raise exception/g) ?? []).length, 2);
});

test("normal APIs separate approval, one dispatch and exact-result completion", async () => {
  const [approve, advance, result, helper] = await Promise.all([
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/normal/approve/route.ts"),
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/normal/advance/route.ts"),
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/normal/result/route.ts"),
    read("src/lib/shoplingPriceModifyBulkNormal.ts"),
  ]);
  assert.match(approve, /CONFIRM_NORMAL_BULK_EXECUTION/);
  assert.doesNotMatch(approve, /dispatchShoplingPriceBulkNormal/);
  assert.match(advance, /reserve_next_shopling_price_bulk_normal_chunk[\s\S]*dispatchShoplingPriceBulkNormal[\s\S]*mark_shopling_price_bulk_normal_running/);
  assert.match(advance, /fail_shopling_price_bulk_normal_dispatch_rejected[\s\S]*block_shopling_price_bulk_normal_uncertain/);
  assert.match(advance, /NORMAL_STATE_TRANSITION_FAILED/);
  assert.match(advance, /normal\.advance\.failure_transition/);
  assert.match(result, /fetchShoplingPriceModifyActionsResult\(requestId\)[\s\S]*finish_shopling_price_bulk_normal_chunk/);
  assert.match(result, /NORMAL_FINISH_EMPTY/);
  assert.match(helper, /goodsKeys.length < 1 \|\| goodsKeys.length > 50/);
  assert.match(helper, /dispatch\.body\.inputs\.request_id = requestId/);
});

test("UI requires explicit approval and uses a timeout-only resumable serial loop", async () => {
  const ui = await read("src/components/shopling-price-modify-runner/ShoplingPriceModifyBulkInputPreview.tsx");
  assert.match(ui, /일반 상품 직렬 실행 승인/);
  assert.match(ui, /detail\.job\.status === "canary_succeeded" && detail\.normal_chunk_count > 0/);
  assert.match(ui, /normalBusyRef/);
  assert.match(ui, /window\.setTimeout/);
  assert.doesNotMatch(ui, /setInterval/);
  assert.match(ui, /한 번에 한 청크만 실행/);
  assert.match(ui, /실패 또는 불확실 상태에서 자동 중단/);
  assert.match(ui, /item_status_counts\.succeeded \* 100/);
  assert.match(ui, /카나리만 포함된 작업이 완료되었습니다/);
});
