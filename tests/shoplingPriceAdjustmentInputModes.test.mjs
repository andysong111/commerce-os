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
  const storage = await read("src/lib/shoplingPriceAdjustmentBulkSelection.ts");

  assert.match(storage, /shoplingPriceAdjustment\.currentBulkSelection/);
  assert.match(input, /stringifyShoplingPriceAdjustmentBulkSelection\(selection\)/);
  assert.match(input, /parseStoredShoplingPriceAdjustmentBulkSelection/);
  assert.match(batch, /parseStoredShoplingPriceAdjustmentBulkSelection/);
  assert.match(batch, /확인 후 실제 Bulk 시작/);
  assert.match(batch, /위 일괄 또는 개별 설정/);
  assert.match(batch, /samePreparedInput\(preparedInput, parsed\)/);
  assert.match(batch, /입력 상품 또는 조정률이 변경되었습니다/);
  assert.doesNotMatch(batch, /window\.confirm/);
});

test("bulk selection survives a login round trip and final writes never auto-retry", async () => {
  const page = await read("src/app/shopling-price-adjustment-runner/page.tsx");
  const route = await read("src/app/api/shopling-price-adjustment/bulk/jobs/route.ts");
  const input = await read("src/components/shopling-price-adjustment/ShoplingPriceAdjustmentInputPreview.tsx");
  const batch = await read("src/components/shopling-price-adjustment/ShoplingPriceAdjustmentBatchCanaryPanel.tsx");
  const storage = await read("src/lib/shoplingPriceAdjustmentBulkSelection.ts");
  const apiClient = await read("src/lib/shoplingPriceAdjustmentApiClient.ts");
  const login = await read("src/app/login/page.tsx");

  assert.match(page, /getOpsCurrentUser\(\)/);
  assert.match(page, /next=%2Fshopling-price-adjustment-runner/);
  assert.match(input, /restoredSelection/);
  assert.match(input, /bulkSelectionStorageReady/);
  assert.match(storage, /복원됨/);
  assert.match(storage, /label: selection\.label/);
  assert.match(storage, /mode: selection\.mode/);
  assert.match(batch, /requestShoplingPriceAdjustmentApi/);
  assert.match(apiClient, /credentials: "same-origin"/);
  assert.match(apiClient, /getSession\(\)/);
  assert.match(apiClient, /Bearer \$\{data\.session\.access_token\}/);
  assert.match(batch, /setLoginRequired\(true\)/);
  assert.match(batch, /로그인 다시 하기/);
  assert.match(batch, /force=1/);
  assert.match(login, /params\.force !== "1"/);
  assert.match(batch, /진단번호/);
  assert.match(
    batch,
    /localStorage\.setItem\(JOB_STORAGE_KEY, id\);[\s\S]*setPreparedInput\(null\);[\s\S]*\/start/,
  );
  assert.match(batch, /existingJobBlocksCreate/);
  assert.match(batch, /blocksNewJob\(candidate\.status\)/);
  assert.match(batch, /기존 Bulk 작업을 먼저 완료하거나 상태를 확인하세요/);
  assert.match(batch, /const existingJob = created\.active_job/);
  assert.match(batch, /existingJob\?\.id/);
  assert.match(batch, /SHOPLING_PRICE_ADJUSTMENT_BULK_SELECTION_STORAGE_KEY/);
  assert.match(batch, /window\.location\.reload\(\)/);
  assert.match(route, /ADJUSTMENT_BULK_ACTIVE_JOB_EXISTS/);
  assert.match(route, /active_job: existing\.data/);
  assert.match(route, /active_job: active\.data \?\? null/);
  assert.match(route, /\.in\("status", \["prepared", "running", "paused", "dispatch_uncertain"\]\)/);
  assert.doesNotMatch(batch, /retry|재시도/);
});
