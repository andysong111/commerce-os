import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../src/lib/stage8ProvenSkuSalesGapLiveAudit.ts", import.meta.url),
  "utf8",
);
const pageSource = fs.readFileSync(
  new URL("../src/app/stage8-proven-sku-sales-gap-live-audit/page.tsx", import.meta.url),
  "utf8",
);

test("live gap scan is bounded and only targets coverage-gap SKUs", () => {
  assert.match(source, /MAX_RANGE_DAYS = 30/);
  assert.match(source, /MAX_GLOBAL_RANGES = 5/);
  assert.match(source, /row\.state === "LATEST_COVERAGE_GAP"/);
  assert.match(source, /splitShoplingDateRange/);
  assert.match(source, /PROVEN_SKU_GAP_RANGE_LIMIT_EXCEEDED/);
});

test("adjusted residual is produced only after complete identity-clean reads", () => {
  assert.match(source, /completedRangeCount === accumulator\.requiredRangeCount/);
  assert.match(source, /legacyModelWithoutCurrentIdentityRows === 0/);
  assert.match(source, /foreignBcodeConflictRows === 0/);
  assert.match(source, /unresolvedPackRows === 0/);
  assert.match(source, /state === "IDENTITY_CLEAN"/);
  assert.match(source, /target\.latestOrderQuantity -\s*accumulator\.currentIdentityGapUnits -\s*target\.canonicalSalesAfterGap/);
});

test("Shopling access is read-only and cannot promote inventory or purchase", () => {
  assert.match(source, /client\.read\("orders", range\)/);
  assert.match(source, /businessWritesPerformed: false/);
  assert.match(source, /inventoryPromotionAllowed: false/);
  assert.match(source, /purchaseWritesEnabled: false/);
  assert.match(source, /inventoryWritesEnabled: false/);
  assert.doesNotMatch(source, /\.from\([^\n]+\)[\s\S]{0,200}\.insert\(/);
  assert.doesNotMatch(source, /\.from\([^\n]+\)[\s\S]{0,200}\.update\(/);
  assert.doesNotMatch(source, /\.from\([^\n]+\)[\s\S]{0,200}\.upsert\(/);
  assert.doesNotMatch(source, /fetch\([^)]*method:\s*["'](?:POST|PUT|PATCH|DELETE)/i);
});

test("operator page explicitly keeps adjusted gap result provisional", () => {
  assert.match(pageSource, /BOUNDED SHOPLING READ · NO INVENTORY PROMOTION/);
  assert.match(pageSource, /Business write/);
  assert.match(pageSource, /0 · READ ONLY/);
  assert.match(pageSource, /실제재고 승격은 금지/);
});
