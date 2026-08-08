import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [workflow, api, page, engine, candidateParity] = await Promise.all([
  readFile("src/lib/stage8CandidateMismatchEvidence.ts", "utf8"),
  readFile("src/app/api/stage8/candidate-mismatch-evidence/route.ts", "utf8"),
  readFile("src/app/stage8-candidate-mismatch-evidence/page.tsx", "utf8"),
  readFile("src/lib/stage8DemandMismatchEvidenceEngine.ts", "utf8"),
  readFile("src/lib/stage8CandidateDemandParity.ts", "utf8"),
]);

test("candidate mismatch evidence is pinned to the exact pre-write parity and sales candidate", () => {
  assert.match(workflow, /loadCandidateDemandParityStatus/);
  assert.match(workflow, /loadLatestCandidateSalesSnapshot/);
  assert.match(workflow, /parity\.state !== "MISMATCH"/);
  assert.match(workflow, /candidateSalesRequestId/);
  assert.match(workflow, /candidateEventFingerprint/);
  assert.match(workflow, /candidatePlanFingerprint/);
  assert.match(workflow, /candidateParityFingerprint/);
  assert.match(workflow, /CANDIDATE_MISMATCH_EVIDENCE_CONTEXT_CHANGED_RERUN_PARITY/);
});

test("only mismatch targets from the candidate parity are rescanned", () => {
  assert.match(workflow, /parity\.report\.mismatchSamples/);
  assert.match(workflow, /parity\.report\.missingDirectBarcodes/);
  assert.match(workflow, /parity\.report\.directOnlyManagedBarcodes/);
  assert.match(workflow, /targetBarcodes: \[\.\.\.targets\]\.sort\(\)/);
  assert.match(workflow, /compileDemandMismatchEvidenceChunk\([\s\S]*request\.targetBarcodes/);
});

test("candidate evidence reuses the same row-level canonical versus legacy classifier", () => {
  assert.match(workflow, /combineDemandMismatchEvidenceChunks/);
  assert.match(workflow, /compileDemandMismatchEvidenceChunk/);
  assert.match(engine, /CANONICAL_HISTORICAL_BARCODE_LEGACY_ACTIVE_ONLY/);
  assert.match(engine, /LEGACY_ACTIVE_IDENTITY_MISSING/);
  assert.match(engine, /RESOLVER_QUANTITY_RULE_DIFFERENCE/);
  assert.match(engine, /RESOLVER_REVENUE_RULE_DIFFERENCE/);
  assert.match(page, /Candidate는 비활성 관리 SKU 역사 바코드를 보존/);
});

test("candidate mismatch workflow is read-only for business ledgers", () => {
  assert.match(workflow, /new ShoplingReadClient/);
  assert.match(workflow, /commerce_operation_runs/);
  assert.doesNotMatch(workflow, /applyProductMasterShoplingSalesEvents|inventory_movements|sku_receipt_costs|calculateProductDecisionPlan|1688/i);
  assert.doesNotMatch(api, /canary|full|applyProductMasterShoplingSalesEvents/i);
  assert.match(page, /Product Master 판매원장·발주·가격·재고·입고원가·단종은 변경하지 않습니다/);
});

test("same-origin API exposes only start and bounded run-next actions", () => {
  assert.match(api, /isSameOriginOpsRequest/);
  assert.match(api, /export const maxDuration = 300/);
  assert.match(api, /run-next/);
  assert.match(api, /createCandidateMismatchEvidenceRequest/);
});

test("candidate parity remains fail-closed until evidence is explicitly promoted", () => {
  assert.match(candidateParity, /state: "IDLE" \| "QUEUED" \| "RUNNING" \| "MATCH" \| "MISMATCH" \| "FAILED"/);
  assert.match(candidateParity, /blockerCount/);
  assert.doesNotMatch(candidateParity, /SAFE_CANONICAL_SUPERSET/);
});
