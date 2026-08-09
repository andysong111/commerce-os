import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const validation = await readFile(
  "src/lib/stage8LatestOrderProvisionalValidation.ts",
  "utf8",
);
const evidence = await readFile(
  "src/data/stage8LegacyOrderSurrogateValidationEvidence.ts",
  "utf8",
);
const page = await readFile(
  "src/app/stage8-latest-order-provisional-validation/page.tsx",
  "utf8",
);

test("latest order quantity is explicit validation-only legacy evidence", () => {
  assert.match(evidence, /latestOrderQuantity:\s*6000/);
  assert.match(evidence, /latestOrderDate:\s*"2025-09-29"/);
  assert.match(evidence, /confirmedInbound:\s*false/);
  assert.match(evidence, /inventoryUseAllowed:\s*false/);
});

test("validation reuses exact canonical sales events and deduplicates chunks", () => {
  assert.match(validation, /SALES_EVENT_CHUNK/);
  assert.match(validation, /loadProductMasterShoplingSalesEventSyncStatus/);
  assert.match(validation, /combineProductMasterShoplingSalesEventChunks/);
  assert.match(validation, /event\.validSale/);
  assert.match(validation, /event\.occurredAt/);
  assert.match(validation, /event\.quantity/);
});

test("candidate formula is checked at zero seven fourteen and twenty-one day delays", () => {
  assert.match(validation, /LEAD_DAY_SCENARIOS = \[0, 7, 14, 21\]/);
  assert.match(validation, /latestOrderQuantity - canonicalSalesSinceStart/);
  assert.match(validation, /diagnosticResidualQuantity/);
  assert.match(validation, /absoluteErrorPct/);
  assert.match(page, /7·14·21일/);
});

test("validation cannot write or promote inventory", () => {
  assert.match(validation, /confirmedInbound:\s*false/);
  assert.match(validation, /inventoryUseAllowed:\s*false/);
  assert.match(validation, /operationalEstimatePromotionAllowed:\s*false/);
  assert.match(validation, /inventoryWritesEnabled:\s*false/);
  assert.doesNotMatch(validation, /method:\s*["']POST/);
  assert.match(page, /자동 승격 금지/);
});
