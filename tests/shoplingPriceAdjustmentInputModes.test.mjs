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
    "최대 20,000개",
  ]) assert.match(component, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

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
