import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, page] = await Promise.all([
  readFile("src/lib/stage8StocktakeInterventionPlan.ts", "utf8"),
  readFile("src/app/stage8-stocktake-intervention-plan/page.tsx", "utf8"),
]);

test("stocktake intervention is downstream only from the purchase-only cost trust gate", () => {
  assert.match(engine, /loadLegacyVerifiedCostReadiness/);
  assert.match(engine, /row\.immediateStocktakeEligible/);
  assert.match(engine, /row\.purchaseCostTrusted/);
  assert.match(engine, /!row\.inventoryVerified/);
  assert.match(engine, /!row\.inventoryRequiresReview/);
});

test("human intervention is minimized to one canary before the 80 percent set", () => {
  assert.match(engine, /TARGET_SPEND_COVERAGE = 0\.8/);
  assert.match(engine, /firstCanaryBarcode/);
  assert.match(engine, /requestedOperatorFields: \["barcode", "physicalQuantity"\]/);
  assert.match(page, /CANARY 1건/);
  assert.match(page, /실물 수량만/);
  assert.match(page, /CANARY가 가장 먼저 확인할 1건/);
});

test("planning remains read-only and cannot change inventory or purchase", () => {
  assert.match(engine, /stocktakeWritesEnabled: false/);
  assert.match(engine, /purchaseWritesEnabled: false/);
  assert.match(page, /0 · READ ONLY/);
  assert.doesNotMatch(`${engine}\n${page}`, /method:\s*["']POST["']|upsertRows|insert\(|update\(|delete\(/);
});

test("plan is fingerprint-bound to current cost-trust evidence", () => {
  assert.match(engine, /sourceFingerprint: readiness\.fingerprint/);
  assert.match(engine, /planFingerprint/);
  assert.match(engine, /purchaseUnitCostKrw/);
  assert.match(engine, /conservativeExpectedCost/);
});
