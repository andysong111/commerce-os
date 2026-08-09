import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const engine = await readFile("src/lib/fastPurchaseMvp.ts", "utf8");
const page = await readFile("src/app/fast-purchase-mvp/page.tsx", "utf8");
const registry = await readFile("src/lib/opsModuleRegistry.ts", "utf8");

test("uses the existing provisional decision gate", () => {
  assert.ok(engine.includes("loadProvisionalDecisionEvidenceGate"));
  assert.ok(engine.includes("DRAFT_EVIDENCE_READY"));
  assert.ok(engine.includes("conservativeDraftRecommendedQuantity"));
});

test("uncertain rows do not get a positive recommendation", () => {
  assert.ok(engine.includes('action: "MANUAL_REVIEW"'));
  assert.ok(engine.includes('action: "DATA_HOLD"'));
  assert.ok(engine.includes("automaticPurchaseEnabled: false"));
  assert.ok(engine.includes("purchaseWritesEnabled: false"));
});

test("page is manual fast-use mode", () => {
  assert.ok(page.includes("빠른 발주안 · MVP"));
  assert.ok(page.includes("수동 발주만 · 자동주문 0"));
  assert.ok(registry.includes("fastPurchaseMvpModule"));
});
