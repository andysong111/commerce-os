import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, page, registry, policy] = await Promise.all([
  readFile("src/lib/fastPurchaseMvp.ts", "utf8"),
  readFile("src/app/fast-purchase-mvp/page.tsx", "utf8"),
  readFile("src/lib/opsModuleRegistry.ts", "utf8"),
  readFile("docs/fast-purchase-mvp-operating-policy.md", "utf8"),
]);

test("v2 reuses existing diagnostics and purchase engine inputs", () => {
  assert.ok(engine.includes("loadProvisionalInventoryDiagnostics"));
  assert.ok(engine.includes("loadCanonicalPurchaseShadow"));
  assert.ok(engine.includes("loadProductPlanningSnapshot"));
  assert.ok(engine.includes("calculateNetRequirement"));
});

test("stable two-sided bands keep the existing conservative behavior", () => {
  assert.ok(engine.includes('row.decisionState === "ORDER_DIRECTION_STABLE"'));
  assert.ok(engine.includes("row.conservativeDraftRecommendedQuantity"));
  assert.ok(engine.includes('basis: "TWO_SIDED_BAND"'));
  assert.ok(engine.includes('action: "MANUAL_REVIEW"'));
});

test("missing latest evidence may use only an existing cumulative residual as upper-biased fallback", () => {
  assert.ok(engine.includes("row.cumulativeResidualCandidate"));
  assert.ok(engine.includes('basis: "CUMULATIVE_UPPER_BIASED"'));
  assert.ok(engine.includes('riskBias: "UNDER_ORDER_BIASED"'));
  assert.ok(engine.includes('row.state !== "IDENTITY_BLOCKED"'));
  assert.ok(engine.includes("availableQuantity: fallbackInventory"));
});

test("fallback keeps current demand commitment MOQ and carton calculation", () => {
  assert.ok(engine.includes("purchase.rawRecommendedQty ?? purchase.recommendedQty"));
  assert.ok(engine.includes("ledgerCommitment: integer(purchase.openCommitment)"));
  assert.ok(engine.includes("profile.moq"));
  assert.ok(engine.includes("profile.cartonQuantity"));
});

test("fast mode remains manual and cannot write purchases or inventory", () => {
  assert.ok(engine.includes("manualOrderOnly: true"));
  assert.ok(engine.includes("automaticPurchaseEnabled: false"));
  assert.ok(engine.includes("purchaseWritesEnabled: false"));
  assert.ok(engine.includes("inventoryWritesEnabled: false"));
  assert.ok(page.includes("수동 발주만 · 자동주문 0"));
  assert.ok(page.includes("과잉발주보다 발주 지연 쪽 위험"));
});

test("dashboard and policy describe the v2 compromise", () => {
  assert.ok(registry.includes("fastPurchaseMvpModule"));
  assert.ok(page.includes("FAST USE · PROVISIONAL V2 · SPEED FIRST"));
  assert.ok(policy.includes("상한편향 절충값"));
  assert.ok(policy.includes("SOLD_OUT_RESET=0"));
});
