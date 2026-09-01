import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0318/download/route.ts", import.meta.url);

test("v0.3.18 persists result evidence in a tab-scoped background bus", async () => {
  const source = await readFile(packageRoute, "utf8");
  for (const needle of [
    'const VERSION = "0.3.18"',
    'RESULT_FRAME_PUSH_MESSAGE',
    'RESULT_FRAME_PULL_MESSAGE',
    'RESULT_FRAME_STORE_KEY',
    'storeResultFrameEvidence',
    'readResultFrameEvidence',
    'persistMallResultEvidence',
    'await resultContextGoodsKeys()',
  ]) assert.equal(source.includes(needle), true, `missing ${needle}`);
});

test("v0.3.18 starts A18 automation before any manual search result exists", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.equal(source.includes('v0318_content_a18_zero_search_recognition_missing'), true);
  assert.equal(source.includes('사용자가 검색 버튼을 먼저 누를 필요가 없습니다'), true);
  assert.equal(source.includes('&& /총\\s*조회수'), false, 'A18 recognition must not require a prior result count');
});

test("v0.3.18 migrates active v0.3.17 state and keeps failure-safe settlement", async () => {
  const source = await readFile(packageRoute, "utf8");
  for (const needle of [
    'CommerceOsShoplingParallelRunV0317'.replace('CommerceOs', 'commerceOs'),
    'commerceOsShoplingParallelWorkerV0317',
    'commerceOsShoplingMarketSelectionQueueV0317',
    'commerceOsShoplingParallelWorkerMetaV0317',
    'sent/confirm_needed',
    '같은 탭의 증거만 읽으므로',
  ]) assert.equal(source.includes(needle), true, `missing ${needle}`);
});
