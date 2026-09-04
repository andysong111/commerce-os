import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("confirmed receipt queues selling only for a previously synchronized stockout B-code", async () => {
  const source = await read("src/app/api/china-order-ledger/events/route.ts");
  assert.match(source, /event\.status === "RECEIVED"/);
  assert.match(source, /event\.status === "PARTIALLY_RECEIVED"/);
  assert.match(source, /latestSuccessfulShoplingStatus === "SOLD_OUT"/);
  assert.match(source, /!row\.pendingJobId/);
  assert.match(source, /desiredStatus: "SELLING"/);
  assert.match(source, /createPendingShoplingInventorySync/);
});

test("option and single receipt restoration keep their distinct Shopling routes", async () => {
  const source = await read("src/app/api/china-order-ledger/events/route.ts");
  assert.match(source, /A6 판매중 전환 후 A22 상품옵션전송 대기/);
  assert.match(source, /A6 판매중 전환 후 A21 상품판매상태 판매중 수정전송 대기/);
});

test("receipt persistence remains successful even if the follow-up Shopling queue fails", async () => {
  const source = await read("src/app/api/china-order-ledger/events/route.ts");
  assert.match(source, /try \{/);
  assert.match(source, /catch \(restoreError\)/);
  assert.match(source, /SHOPLING_SELLING_RESTORE_QUEUE_FAILED/);
  assert.match(source, /automaticSellingJob: automaticSellingJob\?\.event \?\? null/);
});
