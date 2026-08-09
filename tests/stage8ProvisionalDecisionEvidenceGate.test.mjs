import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, page] = await Promise.all([
  readFile("src/lib/stage8ProvisionalDecisionEvidenceGate.ts", "utf8"),
  readFile("src/app/stage8-provisional-decision-evidence-gate/page.tsx", "utf8"),
]);

test("gate consumes the read-only provisional inventory diagnostics", () => {
  assert.match(engine, /loadProvisionalInventoryDiagnostics/);
  assert.match(engine, /diagnostics\.state === "READY_READ_ONLY"/);
});

test("only direction-stable order evidence can become a draft evidence candidate", () => {
  assert.match(engine, /row\.decisionState === "ORDER_DIRECTION_STABLE"/);
  assert.match(engine, /state: "DRAFT_EVIDENCE_READY"/);
  assert.match(engine, /row\.conservativeDraftRecommendedQuantity > 0/);
  assert.match(engine, /row\.decisionState === "HOLD_DIRECTION_STABLE"/);
  assert.match(engine, /state: "HOLD_EVIDENCE_READY"/);
  assert.match(engine, /state: "INVENTORY_SENSITIVE"/);
});

test("incomplete bands fail closed", () => {
  assert.match(engine, /row\.state !== "BAND_READY"/);
  assert.match(engine, /state: "INSUFFICIENT_EVIDENCE"/);
  assert.match(engine, /provisionalDecisionEvidenceReady: false/);
});

test("the gate never creates a purchase or inventory write", () => {
  assert.match(engine, /actualDraftCreationEnabled: false/);
  assert.match(engine, /automaticPurchaseEnabled: false/);
  assert.match(engine, /inventoryPromotionAllowed: false/);
  assert.match(engine, /purchaseWritesEnabled: false/);
  assert.match(engine, /inventoryWritesEnabled: false/);
  assert.match(page, /ACTUAL DRAFT WRITE 0/);
  assert.doesNotMatch(engine, /createSupabaseAdminClient/);
  assert.doesNotMatch(engine, /\.from\(/);
  assert.doesNotMatch(engine, /\.(insert|upsert|delete)\(/);
  assert.doesNotMatch(engine, /fetch\(/);
});

test("operator page states that provisional is not verified", () => {
  assert.match(page, /PROVISIONAL ≠ VERIFIED/);
  assert.match(page, /전수 재고조사 없이 운영/);
  assert.match(page, /EVIDENCE ONLY/);
});
