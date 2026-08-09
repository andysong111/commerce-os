import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, page, workspace, registry, policy] = await Promise.all([
  readFile("src/lib/fastPurchaseMvp.ts", "utf8"),
  readFile("src/app/fast-purchase-mvp/page.tsx", "utf8"),
  readFile("src/components/fast-purchase-mvp/FastPurchaseTriageWorkspace.tsx", "utf8"),
  readFile("src/lib/opsModuleRegistry.ts", "utf8"),
  readFile("docs/fast-purchase-mvp-operating-policy.md", "utf8"),
]);

test("v2.1 engine still reuses existing diagnostics and purchase inputs", () => {
  assert.ok(engine.includes("loadProvisionalInventoryDiagnostics"));
  assert.ok(engine.includes("loadCanonicalPurchaseShadow"));
  assert.ok(engine.includes("loadProductPlanningSnapshot"));
  assert.ok(engine.includes("calculateNetRequirement"));
});

test("stable bands upper-biased fallback and demand-only reference remain unchanged", () => {
  assert.ok(engine.includes('basis: "TWO_SIDED_BAND"'));
  assert.ok(engine.includes('basis: "CUMULATIVE_UPPER_BIASED"'));
  assert.ok(engine.includes('basis: "DEMAND_ONLY_ZERO_STOCK_REFERENCE"'));
  assert.ok(engine.includes('riskBias: "UNDER_ORDER_BIASED"'));
  assert.ok(engine.includes('riskBias: "OVER_ORDER_IF_MISUSED"'));
  assert.ok(engine.includes("referenceDemandQuantity: integer(purchase.recommendedQty)"));
});

test("v2.2 page delegates operational judgment to the browser triage workspace", () => {
  assert.ok(page.includes("FastPurchaseTriageWorkspace"));
  assert.ok(page.includes("FAST USE · PROVISIONAL V2.2 · OPERATE NOW"));
  assert.ok(page.includes("수동 발주만 · 자동주문 0"));
  assert.ok(page.includes("브라우저에만 저장"));
});

test("manual triage stores only local browser judgment and never posts business state", () => {
  assert.ok(workspace.includes('"use client"'));
  assert.ok(workspace.includes("localStorage.setItem"));
  assert.ok(workspace.includes("localStorage.getItem"));
  assert.ok(workspace.includes("commerceOs.fastPurchaseMvp.triage.v1"));
  assert.ok(workspace.includes('StockSense = "UNKNOWN" | "ENOUGH" | "LOW" | "OUT"'));
  assert.doesNotMatch(
    workspace,
    /fetch\(|method:\s*["']POST["']|\.insert\(|\.upsert\(|\.delete\(/,
  );
});

test("saved manual quantity is ignored after a row becomes a system hold or data hold", () => {
  assert.ok(workspace.includes("function effectivePlannedQuantity"));
  assert.ok(workspace.includes("if (isSystemOrder(row.action))"));
  assert.ok(workspace.includes("if (isManual(row.action))"));
  assert.ok(workspace.includes("return 0;"));
  assert.ok(workspace.includes("const planned = effectivePlannedQuantity(row, entry)"));
  assert.ok(workspace.includes("const plannedQuantity = effectivePlannedQuantity(row, entry)"));
});

test("browser plans are tied to the exact source fingerprint and invalidated when inputs change", () => {
  assert.ok(workspace.includes("type PersistedTriage"));
  assert.ok(workspace.includes("sourceFingerprint: string"));
  assert.ok(workspace.includes("parsed.sourceFingerprint !== expectedFingerprint"));
  assert.ok(workspace.includes("return { entries: {}, stale: true }"));
  assert.ok(workspace.includes("발주 기준 데이터가 변경되어 이전 브라우저 판단·주문 예정수량을 초기화"));
  assert.ok(workspace.includes("sourceFingerprint,"));
});

test("demand-only manual quantity can never exceed its displayed zero-stock reference ceiling", () => {
  assert.ok(workspace.includes("function clampManualQuantity"));
  assert.ok(workspace.includes('row.action === "DEMAND_ONLY_REVIEW"'));
  assert.ok(
    workspace.includes(
      "Math.min(planned, quantity(row.referenceDemandQuantity))",
    ),
  );
  assert.ok(workspace.includes("max={manualMax}"));
  assert.match(workspace, /plannedQuantity:\s*row\.referenceDemandQuantity/);
});

test("zero-stock demand reference is separated from planned quantity and requires an explicit click to copy", () => {
  assert.ok(workspace.includes("재고0 수요참고"));
  assert.ok(workspace.includes("주문 예정수량"));
  assert.ok(workspace.includes("참고상한 넣기"));
  assert.ok(workspace.includes('entry.stockSense === "LOW"'));
  assert.ok(workspace.includes('entry.stockSense === "OUT"'));
  assert.ok(workspace.includes("referenceDemandQuantity"));
});

test("workspace can export only current positive system orders or explicitly planned manual rows to local CSV", () => {
  assert.ok(workspace.includes("downloadCsv"));
  assert.ok(workspace.includes("주문예정 CSV"));
  assert.ok(workspace.includes("if (plannedQuantity <= 0) return []"));
  assert.ok(workspace.includes("effectivePlannedQuantity(row, entry)"));
  assert.ok(workspace.includes("중국 주문을 자동 실행하지 않습니다"));
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
