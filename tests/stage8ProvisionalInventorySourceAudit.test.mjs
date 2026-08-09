import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const audit = await readFile(
  "src/lib/stage8ProvisionalInventorySourceAudit.ts",
  "utf8",
);
const page = await readFile(
  "src/app/stage8-provisional-inventory-source-audit/page.tsx",
  "utf8",
);
const evidence = await readFile(
  "src/data/stage8ProvisionalInventoryValidationEvidence.ts",
  "utf8",
);
const reader = await readFile(
  "src/lib/productMasterInventoryCostReadiness.ts",
  "utf8",
);

test("source audit reads Product Master quantity evidence but never writes inventory", () => {
  assert.match(audit, /loadProductMasterInventoryCostReadiness/);
  assert.match(audit, /loadInventoryVerificationPriority/);
  assert.match(audit, /operationalEstimatePromotionAllowed:\s*false/);
  assert.match(audit, /inventoryWritesEnabled:\s*false/);
  assert.doesNotMatch(audit, /fetch\([^)]*method:\s*["']POST/);
  assert.doesNotMatch(audit, /stocktake-canary|SOLD_OUT_RESET.*POST|inventory-movements.*POST/);
});

test("simple inbound minus sales remains diagnostic until a common baseline is proven", () => {
  assert.match(audit, /diagnosticNetQuantity/);
  assert.match(audit, /inbound - sales/);
  assert.match(audit, /QUANTITY_HISTORY_PRESENT_BASELINE_UNPROVEN/);
  assert.match(audit, /공통 시작재고 기준이 증명되기 전까지/);
  assert.match(page, /진단값일 뿐 실제 재고로 쓰지 않으며/);
  assert.match(page, /시작재고 기준이 증명되지 않으면 운영 추정재고로 승격하지 않습니다/);
});

test("BGG1-1 physical count is validation-only evidence and cannot become inventory directly", () => {
  assert.match(evidence, /barcode:\s*"BGG1-1"/);
  assert.match(evidence, /physicalQuantity:\s*3000/);
  assert.match(evidence, /validationOnly:\s*true/);
  assert.match(evidence, /inventoryUseAllowed:\s*false/);
  assert.match(audit, /validationOnly:\s*Boolean\(sample\)/);
  assert.match(audit, /operationalEstimateAllowed:\s*false/);
  assert.match(page, /Product Master 재고나 발주수량에 직접 넣지 않습니다/);
});

test("reader remains backward compatible while Product Master rollout catches up", () => {
  assert.match(reader, /inboundQuantityTotal\?: number/);
  assert.match(reader, /salesQuantityTotal\?: number/);
  assert.match(reader, /salesMonthlyRowCount\?: number/);
  assert.match(audit, /SOURCE_FIELDS_NOT_DEPLOYED/);
  assert.match(audit, /WAITING_FOR_PRODUCT_MASTER_SCHEMA/);
});
