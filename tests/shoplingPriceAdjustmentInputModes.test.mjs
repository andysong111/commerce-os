import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("price adjustment screen supports separate uniform and individual input modes", async () => {
  const component = await read("src/components/shopling-price-adjustment/ShoplingPriceAdjustmentInputPreview.tsx");

  for (const phrase of [
    "일괄 설정",
    "개별 설정",
    "전체 상품 공통 인상·인하율",
    "goods_key 1열 CSV·XLSX",
    "goods_key + 조정률 2열 CSV·XLSX",
    "상품별 개별 입력",
    "최대 10,000개",
  ]) assert.match(component, new RegExp(phrase.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&")));

  assert.match(component, /parseShoplingPriceBulkPaste/);
  assert.match(component, /parseShoplingPriceBulkFile/);
  assert.match(component, /parseShoplingPriceAdjustmentPaste/);
  assert.match(component, /parseShoplingPriceAdjustmentFile/);
  assert.match(component, /type InputMode = "uniform" \| "individual"/);
});

test("uniform mode converts one common rate into one row per unique goods key", async () => {
  const component = await read("src/components/shopling-price-adjustment/ShoplingPriceAdjustmentInputPreview.tsx");
  assert.match(component, /function buildUniformAdjustmentResult/);
  assert.match(component, /goodsInput\.goodsKeys\.map\(\(goodsKey\) => \(\{ \.\.\.template, goodsKey, adjustmentBps \}\)\)/);
  assert.match(component, /duplicateCount: goodsInput\.duplicateCount/);
  assert.match(component, /conflictCount: 0/);
  assert.match(component, /invalid: goodsInput\.invalid/);
});

test("changing input invalidates an old read-only plan while keeping the first-10 canary", async () => {
  const component = await read("src/components/shopling-price-adjustment/ShoplingPriceAdjustmentInputPreview.tsx");
  assert.match(component, /localStorage\.removeItem\(PLAN_REQUEST_STORAGE_KEY\)/);
  assert.match(component, /selection\.result\.rows\.slice\(0, 10\)/);
  assert.match(component, /가격 수정 API는 호출하지 않습니다/);
});

test("bulk runner consumes validated file selections and uses an in-page confirmation", async () => {
  const input = await read("src/components/shopling-price-adjustment/ShoplingPriceAdjustmentInputPreview.tsx");
  const batch = await read("src/components/shopling-price-adjustment/ShoplingPriceAdjustmentBatchCanaryPanel.tsx");

  assert.match(input, /shoplingPriceAdjustment\.currentBulkSelection/);
  assert.match(input, /localStorage\.setItem\(BULK_SELECTION_STORAGE_KEY/);
  assert.match(batch, /localStorage\.getItem\(BULK_SELECTION_STORAGE_KEY\)/);
  assert.match(batch, /확인 후 실제 Bulk 시작/);
  assert.match(batch, /위 일괄 또는 개별 설정/);
  assert.match(batch, /samePreparedInput\(preparedInput, parsed\)/);
  assert.match(batch, /입력 상품 또는 조정률이 변경되었습니다/);
  assert.doesNotMatch(batch, /window\.confirm/);
});
