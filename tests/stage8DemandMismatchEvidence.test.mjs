import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, workflow, page, api, cron, parity] = await Promise.all([
  readFile("src/lib/stage8DemandMismatchEvidenceEngine.ts", "utf8"),
  readFile("src/lib/stage8DemandMismatchEvidence.ts", "utf8"),
  readFile("src/app/stage8-demand-mismatch-evidence/page.tsx", "utf8"),
  readFile("src/app/api/stage8/demand-mismatch-evidence/route.ts", "utf8"),
  readFile("src/app/api/cron/stage8-canonical-demand-parity/route.ts", "utf8"),
  readFile("src/lib/stage8CanonicalDemandParity.ts", "utf8"),
]);

test("evidence compiler sends the same raw Shopling row through canonical and legacy resolvers", () => {
  assert.match(engine, /aggregateProductMasterShoplingSalesEventChunk\([\s\S]*\[raw\]/);
  assert.match(engine, /aggregateShoplingOrderChunk\([\s\S]*\[raw\]/);
  assert.match(engine, /LEGACY_SKU_DIFFERS_FROM_CANONICAL/);
  assert.match(engine, /LEGACY_ACCEPTS_CANONICAL_IGNORES/);
  assert.match(engine, /CANONICAL_ONLY_LEGACY_UNMAPPED/);
  assert.match(engine, /unitDeltaLegacyMinusCanonical/);
  assert.match(engine, /revenueDeltaLegacyMinusCanonical/);
});

test("evidence preserves raw quantity and identity fields needed to explain large anomalies", () => {
  assert.match(engine, /rawMallOrderCount/);
  assert.match(engine, /rawQuantity/);
  assert.match(engine, /rawOptionBarcode/);
  assert.match(engine, /rawPartnerCode/);
  assert.match(engine, /optionId/);
  assert.match(engine, /productId/);
  assert.match(engine, /mallProductKey/);
  assert.match(page, /BAA2-1의 1001개 같은 비정상 집계/);
});

test("evidence request is pinned to the completed parity fingerprints and refuses planning drift", () => {
  assert.match(workflow, /parity\.state !== "MISMATCH"/);
  assert.match(workflow, /planning\.contentFingerprint !== parity\.report\.planningContentFingerprint/);
  assert.match(workflow, /DEMAND_MISMATCH_EVIDENCE_PLANNING_CHANGED_RERUN_PARITY/);
  assert.match(workflow, /canonicalContentFingerprint: parity\.report\.canonicalContentFingerprint/);
  assert.match(workflow, /parityFingerprint: parity\.report\.parityFingerprint/);
  assert.match(workflow, /analysisAsOf: asOf\.toISOString\(\)/);
  assert.match(parity, /mismatchSamples/);
});

test("worker is business-read-only: Shopling GET plus Ops evidence ledger only", () => {
  assert.match(workflow, /new ShoplingReadClient\(config\)\.read\("orders"/);
  assert.match(workflow, /commerce_operation_runs/);
  assert.doesNotMatch(workflow, /applyProductMasterShoplingSalesEvents|calculateProductDecisionPlan|inventory_movements|sku_receipt_costs|1688/i);
  assert.doesNotMatch(cron, /applyProductMasterShoplingSalesEvents|calculateProductDecisionPlan/);
  assert.match(page, /발주·가격·재고·입고원가·단종은 변경하지 않습니다/);
});

test("data-heavy evidence ranges get a bounded long function window", () => {
  assert.match(api, /export const maxDuration = 300/);
  assert.match(cron, /export const maxDuration = 300/);
});

test("existing Stage8 parity cron automatically hands terminal mismatch into evidence collection", () => {
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /current\.state === "MISMATCH"/);
  assert.match(cron, /continueMismatchEvidence/);
  assert.match(cron, /createDemandMismatchEvidenceRequest/);
  assert.match(cron, /runDemandMismatchEvidenceStep/);
  assert.match(cron, /PARITY_REQUEUED/);
  assert.match(api, /isSameOriginOpsRequest/);
  assert.match(api, /run-next/);
  assert.match(api, /createDemandMismatchEvidenceRequest/);
  assert.match(workflow, /MAX_STEP_ATTEMPTS = 3/);
});
