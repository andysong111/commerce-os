import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bridge = readFileSync("src/lib/shoplingPriceAdjustmentBatchCanaryRunner.ts", "utf8");
const panel = readFileSync("src/components/shopling-price-adjustment/ShoplingPriceAdjustmentBatchCanaryPanel.tsx", "utf8");
const page = readFileSync("src/app/shopling-price-adjustment-runner/page.tsx", "utf8");
const runRoute = readFileSync("src/app/api/shopling-price-adjustment/batch-canary/run/route.ts", "utf8");
const resultRoute = readFileSync("src/app/api/shopling-price-adjustment/batch-canary/result/route.ts", "utf8");

test("batch bridge uses isolated workflow artifact confirmation and exact request ids", () => {
  assert.match(bridge, /shopling-price-adjustment-batch-canary\.yml/);
  assert.match(bridge, /shopling-price-adjustment-batch-canary-summary/);
  assert.match(bridge, /CONFIRM_TEN_PRICE_ADJUSTMENT_CANARY/);
  assert.match(bridge, /price-adjust-batch-canary-/);
  assert.match(bridge, /batch_canary_json/);
  assert.match(bridge, /requires_option_write/);
  assert.match(bridge, /SHOPLING_PRICE_MODIFY_ENABLED/);
});

test("batch input is capped at ten and rejects duplicates", () => {
  assert.match(bridge, /const MAX_ROWS = 10/);
  assert.match(bridge, /value\.length > MAX_ROWS/);
  assert.match(bridge, /중복 goods_key/);
  assert.match(bridge, /expected_current_sell_price/);
  assert.match(bridge, /expected_option_signature/);
});

test("batch panel requires exactly ten read-only rows and exposes fail-stop warning", () => {
  assert.match(panel, /const REQUIRED_BATCH_SIZE = 10/);
  assert.match(panel, /rows\.length !== REQUIRED_BATCH_SIZE/);
  assert.match(panel, /requires_option_write/);
  assert.match(panel, /첫 실패 시 남은 상품은 실행하지 않습니다/);
  assert.match(panel, /이미 단일 테스트한 상품은 다시 넣지 마세요/);
  assert.match(panel, /10개 변경 결과 가져오기/);
});

test("page and routes connect the isolated batch panel", () => {
  assert.match(page, /ShoplingPriceAdjustmentBatchCanaryPanel/);
  assert.match(runRoute, /dispatchShoplingPriceAdjustmentBatchCanary/);
  assert.match(resultRoute, /fetchShoplingPriceAdjustmentBatchCanaryResult/);
});
