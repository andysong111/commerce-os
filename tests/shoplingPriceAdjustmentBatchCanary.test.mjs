import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bridge = readFileSync("src/lib/shoplingPriceAdjustmentBatchCanaryRunner.ts", "utf8");
const panel = readFileSync("src/components/shopling-price-adjustment/ShoplingPriceAdjustmentBatchCanaryPanel.tsx", "utf8");
const page = readFileSync("src/app/shopling-price-adjustment-runner/page.tsx", "utf8");
const runRoute = readFileSync("src/app/api/shopling-price-adjustment/batch-canary/run/route.ts", "utf8");
const resultRoute = readFileSync("src/app/api/shopling-price-adjustment/batch-canary/result/route.ts", "utf8");

test("serial bridge uses isolated workflow artifact confirmation and exact request ids", () => {
  assert.match(bridge, /shopling-price-adjustment-batch-canary\.yml/);
  assert.match(bridge, /shopling-price-adjustment-batch-canary-summary/);
  assert.match(bridge, /CONFIRM_FIFTY_PRICE_ADJUSTMENT_SERIAL/);
  assert.match(bridge, /price-adjust-batch-canary-/);
  assert.match(bridge, /batch_canary_json/);
  assert.match(bridge, /requires_option_write/);
  assert.match(bridge, /SHOPLING_PRICE_MODIFY_ENABLED/);
});

test("serial input is capped at fifty and rejects duplicates", () => {
  assert.match(bridge, /const MAX_ROWS = 50/);
  assert.match(bridge, /value\.length > MAX_ROWS/);
  assert.match(bridge, /중복 goods_key/);
  assert.match(bridge, /expected_current_sell_price/);
  assert.match(bridge, /expected_option_signature/);
  assert.match(bridge, /inputCount: input\.length/);
});

test("serial panel reads current individual input and exposes 1-50 fail-stop execution", () => {
  assert.match(panel, /const MAX_SERIAL_SIZE = 50/);
  assert.match(panel, /goods_key와 조정률 직접 붙여넣기/);
  assert.match(panel, /parseShoplingPriceAdjustmentPaste/);
  assert.match(panel, /현재 입력 1~50개 계획 조회/);
  assert.match(panel, /requires_option_write/);
  assert.match(panel, /첫 실패 시 남은 상품은 실행하지 않습니다/);
  assert.match(panel, /실제 변경 결과 가져오기/);
  assert.doesNotMatch(panel, /REQUIRED_BATCH_SIZE = 10/);
});

test("page and routes connect the serial execution panel", () => {
  assert.match(page, /ShoplingPriceAdjustmentBatchCanaryPanel/);
  assert.match(runRoute, /dispatchShoplingPriceAdjustmentBatchCanary/);
  assert.match(resultRoute, /fetchShoplingPriceAdjustmentBatchCanaryResult/);
});
