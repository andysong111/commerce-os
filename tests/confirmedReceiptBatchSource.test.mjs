import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile("src/lib/confirmedReceiptBatchSource.ts", "utf8");

test("exact confirmed-receipt reader always sends the batchId filter", () => {
  assert.match(source, /batchId: String\(input\.batchId\)/);
  assert.match(source, /price-adjustment-receipts\?\$\{params\.toString\(\)\}/);
  assert.match(source, /limit: String\(PAGE_LIMIT\)/);
});

test("source must echo the enforced batch filter and every row must match it", () => {
  assert.match(source, /exactBatchFilter/);
  assert.match(source, /CHINA_RECEIPT_BATCH_FILTER_NOT_ENFORCED/);
  assert.match(source, /row\.batchId !== input\.batchId/);
  assert.match(source, /CHINA_RECEIPT_SOURCE_FOREIGN_BATCH/);
});

test("receipt source stays read only and accepts only known source modes", () => {
  assert.match(source, /payload\.sourceWritesEnabled !== false/);
  assert.match(source, /immutable_inventory_movement/);
  assert.match(source, /legacy_confirmed_batch/);
  assert.match(source, /sourceWritesEnabled: false/);
  assert.doesNotMatch(source, /method:\s*["']POST["']|insert\(|update\(|delete\(/i);
});

test("existing runtime integration secrets are tried without exposure", () => {
  assert.match(source, /CHINA_ORDER_MANAGER_INTEGRATION_SECRET/);
  assert.match(source, /PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET/);
  assert.match(source, /PRODUCT_MASTER_INTEGRATION_SECRET/);
  assert.match(source, /response\.status === 401 \|\| response\.status === 403/);
  assert.doesNotMatch(source, /console\.(log|warn|error).*secret/i);
});
