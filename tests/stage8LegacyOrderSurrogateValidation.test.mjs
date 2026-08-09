import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const validation = await readFile(
  "src/lib/stage8LegacyOrderSurrogateValidation.ts",
  "utf8",
);
const evidence = await readFile(
  "src/data/stage8LegacyOrderSurrogateValidationEvidence.ts",
  "utf8",
);
const page = await readFile(
  "src/app/stage8-legacy-order-surrogate-validation/page.tsx",
  "utf8",
);

test("legacy order quantity is validation evidence, never confirmed inbound", () => {
  assert.match(evidence, /barcode:\s*"BGG1-1"/);
  assert.match(evidence, /cumulativeOrderedQuantity:\s*11533/);
  assert.match(evidence, /confirmedInbound:\s*false/);
  assert.match(evidence, /inventoryUseAllowed:\s*false/);
  assert.match(evidence, /validationOnly:\s*true/);
  assert.match(page, /ORDER HISTORY ≠ CONFIRMED RECEIPT/);
});

test("validation uses exact canonical 12x30 sales and physical sample", () => {
  assert.match(validation, /loadProductMasterCanonicalSalesAudit/);
  assert.match(validation, /provisionalInventoryValidationEvidenceByBarcode/);
  assert.match(validation, /sum\(canonicalRow\.monthlyUnits\)/);
  assert.match(validation, /source\.cumulativeOrderedQuantity - canonical360SalesQuantity/);
  assert.match(validation, /physical\.physicalQuantity/);
});

test("diagnostic order-minus-sales can never be promoted or written", () => {
  assert.match(validation, /diagnosticOrderMinusCanonicalSales/);
  assert.match(validation, /INSUFFICIENT_FOR_OPERATIONAL_ESTIMATE/);
  assert.match(validation, /operationalEstimateAllowed:\s*false/);
  assert.match(validation, /operationalEstimatePromotionAllowed:\s*false/);
  assert.match(validation, /inventoryWritesEnabled:\s*false/);
  assert.doesNotMatch(validation, /method:\s*["']POST/);
  assert.match(page, /실제 재고가 아닙니다/);
  assert.match(page, /운영 추정재고 승격: 금지/);
});

test("validation exposes canonical window and Product Master monthly comparison", () => {
  assert.match(validation, /canonicalWindowStart/);
  assert.match(validation, /canonicalWindowEnd/);
  assert.match(validation, /productMasterMonthlySalesQuantity/);
  assert.match(validation, /shiftDays\(analysisAsOf, -360\)/);
});
