import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, page, registry, policy] = await Promise.all([
  readFile("src/lib/fastPurchaseMvp.ts", "utf8"),
  readFile("src/app/fast-purchase-mvp/page.tsx", "utf8"),
  readFile("src/lib/opsModuleRegistry.ts", "utf8"),
  readFile("docs/fast-purchase-mvp-operating-policy.md", "utf8"),
]);

test("v2.1 still reuses existing diagnostics and purchase engine inputs", () => {
  assert.ok(engine.includes("loadProvisionalInventoryDiagnostics"));
  assert.ok(engine.includes("loadCanonicalPurchaseShadow"));
  assert.ok(engine.includes("loadProductPlanningSnapshot"));
  assert.ok(engine.includes("calculateNetRequirement"));
});

test("stable bands and upper-biased fallback remain unchanged", () => {
  assert.ok(engine.includes('row.decisionState === "ORDER_DIRECTION_STABLE"'));
  assert.ok(engine.includes('basis: "TWO_SIDED_BAND"'));
  assert.ok(engine.includes('basis: "CUMULATIVE_UPPER_BIASED"'));
  assert.ok(engine.includes('riskBias: "UNDER_ORDER_BIASED"'));
  assert.ok(engine.includes("availableQuantity: fallbackInventory"));
});

test("remaining positive purchase candidates become demand-only manual triage", () => {
  assert.ok(engine.includes('action: "DEMAND_ONLY_REVIEW"'));
  assert.ok(engine.includes('basis: "DEMAND_ONLY_ZERO_STOCK_REFERENCE"'));
  assert.ok(engine.includes('riskBias: "OVER_ORDER_IF_MISUSED"'));
  assert.ok(engine.includes("referenceDemandQuantity: integer(purchase.recommendedQty)"));
  assert.ok(engine.includes("recommendedQuantity: 0"));
  assert.ok(engine.includes("manualTriageReady: true"));
});

test("demand-only triage excludes rows already covered by provisional diagnostics", () => {
  assert.ok(engine.includes("diagnosticBarcodes.has(key)"));
  assert.ok(engine.includes('purchase.status === "발주 추천"'));
  assert.ok(engine.includes('purchase.status === "소량 검토"'));
  assert.ok(engine.includes("integer(purchase.recommendedQty) > 0"));
});

test("page clearly separates actual recommendation from zero-stock demand reference", () => {
  assert.ok(page.includes("MVP 주문검토수량"));
  assert.ok(page.includes("재고0 수요참고"));
  assert.ok(page.includes("참고상한을 그대로 주문하면 과잉발주"));
  assert.ok(page.includes("수동 발주만 · 자동주문 0"));
});

test("fast mode remains no-write and reports operational coverage", () => {
  assert.ok(engine.includes("automaticPurchaseEnabled: false"));
  assert.ok(engine.includes("purchaseWritesEnabled: false"));
  assert.ok(engine.includes("inventoryWritesEnabled: false"));
  assert.ok(engine.includes("operationalCoverageCount"));
  assert.ok(engine.includes("manualTriageCount"));
  assert.ok(registry.includes("fastPurchaseMvpModule"));
  assert.ok(policy.includes("상한편향 절충값"));
});
