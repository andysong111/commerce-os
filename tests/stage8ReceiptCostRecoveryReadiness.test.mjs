import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, page] = await Promise.all([
  readFile("src/lib/stage8ReceiptCostRecoveryReadiness.ts", "utf8"),
  readFile("src/app/stage8-receipt-cost-recovery-readiness/page.tsx", "utf8"),
]);

test("receipt cost recovery readiness reuses the existing complete cache and canonical purchase priority", () => {
  assert.match(engine, /readPriceAdjustmentReceiptCache/);
  assert.match(engine, /loadInventoryVerificationPriority/);
  assert.match(engine, /cache\?\.complete === true/);
  assert.match(engine, /purchaseStatus === "발주 추천"/);
  assert.match(engine, /CACHE_RECOVERABLE/);
  assert.match(engine, /NO_CACHE_EVIDENCE/);
});

test("receipt recovery readiness remains read-only and does not treat stock as verified", () => {
  assert.match(engine, /writesEnabled: false/);
  assert.match(engine, /stocktakeStillRequiredAfterCostRecovery/);
  assert.doesNotMatch(engine, /upsertRows|insert\(|update\(|delete\(|method:\s*["']POST["']/);
  assert.doesNotMatch(page, /fetch\([^)]*method:\s*["']POST["']/);
  assert.match(page, /0 · READ ONLY/);
  assert.match(page, /자동 Product Master write · false/);
});

test("protected cost evidence is bounded to recent three receipts within 365 days", () => {
  assert.match(engine, /PROTECTED_COST_WINDOW_DAYS = 365/);
  assert.match(engine, /MAX_PROTECTED_RECEIPTS = 3/);
  assert.match(engine, /\.slice\(0, MAX_PROTECTED_RECEIPTS\)/);
});
