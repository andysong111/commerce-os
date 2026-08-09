import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("purchase candidate identity audit is read only and exposes exact matching keys", async () => {
  const page = await read("src/app/stage8-purchase-candidate-identity-audit/page.tsx");
  assert.match(page, /loadInventoryVerificationPriority/);
  assert.match(page, /row\.purchaseStatus === "발주 추천"/);
  assert.match(page, /row\.barcode/);
  assert.match(page, /row\.modelNo/);
  assert.match(page, /row\.name/);
  assert.match(page, /ORDER HISTORY IS NOT CONFIRMED INBOUND/);
  assert.match(page, /Business write/);
  assert.match(page, /0 · READ ONLY/);
  assert.doesNotMatch(page, /POST|PUT|PATCH|DELETE|fetch\(/);
});
