import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const validation = await readFile(
  "src/lib/stage8ProvisionalInventoryBandValidation.ts",
  "utf8",
);
const page = await readFile(
  "src/app/stage8-provisional-inventory-band-validation/page.tsx",
  "utf8",
);

test("band validation uses the 14-day operating lead scenario and both digital residual candidates", () => {
  assert.match(validation, /OPERATING_LEAD_DAYS = 14/);
  assert.match(validation, /latestScenario\.diagnosticResidualQuantity/);
  assert.match(validation, /cumulativeRow\.diagnosticOrderMinusCanonicalSales/);
  assert.match(validation, /Math\.min\(latestResidual, cumulativeResidual\)/);
  assert.match(validation, /Math\.max\(latestResidual, cumulativeResidual\)/);
});

test("physical BGG1-1 quantity is only used to validate containment and purchase sensitivity", () => {
  assert.match(validation, /provisionalInventoryValidationEvidenceByBarcode/);
  assert.match(validation, /physicalInsideDiagnosticBand/);
  assert.match(validation, /physicalInventoryRecommendedQty/);
  assert.match(page, /실물 3,000개가 진단 밴드 안에 있는가/);
  assert.match(page, /실물 정답 검증/);
});

test("purchase direction is simulated at low high and physical stock with existing net requirement rules", () => {
  assert.match(validation, /calculateNetRequirement/);
  assert.match(validation, /ORDER_DIRECTION_STABLE/);
  assert.match(validation, /HOLD_DIRECTION_STABLE/);
  assert.match(validation, /INVENTORY_SENSITIVE/);
  assert.match(validation, /rawRecommendedQty/);
  assert.match(validation, /openCommitment/);
});

test("diagnostic band can never write or promote inventory or purchase", () => {
  assert.match(validation, /bandIsProvenInventoryBounds:\s*false/);
  assert.match(validation, /inventoryUseAllowed:\s*false/);
  assert.match(validation, /operationalEstimatePromotionAllowed:\s*false/);
  assert.match(validation, /purchaseWritesEnabled:\s*false/);
  assert.match(validation, /inventoryWritesEnabled:\s*false/);
  assert.doesNotMatch(validation, /method:\s*["']POST/);
  assert.match(page, /현재는 검증 전용/);
  assert.match(page, /운영 승격/);
});
