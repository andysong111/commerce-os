import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  engine,
  resilient,
  page,
  workspace,
  registry,
  policy,
  trackerMetadata,
  shoplingIdentity,
] = await Promise.all([
  readFile("src/lib/fastPurchaseMvp.ts", "utf8"),
  readFile("src/lib/fastPurchaseMvpResilient.ts", "utf8"),
  readFile("src/app/fast-purchase-mvp/page.tsx", "utf8"),
  readFile("src/components/fast-purchase-mvp/FastPurchaseTriageWorkspace.tsx", "utf8"),
  readFile("src/lib/opsModuleRegistry.ts", "utf8"),
  readFile("docs/fast-purchase-mvp-operating-policy.md", "utf8"),
  readFile("src/lib/productLaunchPurchaseMetadata.ts", "utf8"),
  readFile("src/lib/shopling/shoplingCurrentModelIdentity.ts", "utf8"),
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

test("v2.3 page keeps browser triage and adds internal draft without external auto-order", () => {
  assert.ok(page.includes("FastPurchaseTriageWorkspace"));
  assert.ok(page.includes("FastPurchaseDraftActions"));
  assert.ok(page.includes("FAST USE · PROVISIONAL V2.3 · OPERATE NOW"));
  assert.ok(page.includes("내부 Draft 가능 · 외부 자동주문 0"));
  assert.ok(page.includes("내부 발주 Draft 저장"));
});

test("transient live failures retry before opening a manual-only last-known fallback", () => {
  assert.ok(resilient.includes("const LOAD_ATTEMPTS = 2"));
  assert.ok(resilient.includes("await loadFastPurchaseMvp()"));
  assert.ok(resilient.includes('dataMode: "LIVE"'));
  assert.ok(resilient.includes('dataMode: "LAST_KNOWN_MANUAL_FALLBACK"'));
  assert.ok(resilient.includes("fallbackReport(errorCode(lastError))"));
  assert.ok(page.includes("실시간 호출 실패 · 마지막 정상 스냅샷으로 수동검토 계속 가능"));
});

test("last-known fallback never carries a system order or system hold decision", () => {
  assert.ok(resilient.includes('action: "DEMAND_ONLY_REVIEW"'));
  assert.ok(resilient.includes("recommendedQuantity: 0"));
  assert.ok(resilient.includes("systemDecisionCount: 0"));
  assert.ok(resilient.includes("orderReviewCount: 0"));
  assert.ok(resilient.includes("holdCount: 0"));
  assert.ok(resilient.includes("automaticPurchaseEnabled: false"));
  assert.ok(resilient.includes("purchaseWritesEnabled: false"));
  assert.ok(resilient.includes("inventoryWritesEnabled: false"));
});

test("last-known fallback keeps all current 42 candidates as manual triage material", () => {
  const matches = resilient.match(/referenceDemandQuantity:\s*\d+\s*\}/g) ?? [];
  assert.equal(matches.length, 42);
  assert.ok(resilient.includes('barcode: "BGG1-1"'));
  assert.ok(resilient.includes('barcode: "BCA4-1"'));
  assert.ok(resilient.includes("manualTriageCount: rows.length"));
  assert.ok(resilient.includes("operationalCoverageCount: rows.length"));
});

test("fast purchase uses live Shopling model_nm instead of product title as model name", () => {
  assert.ok(engine.includes("loadShoplingCurrentModelSnapshot"));
  assert.ok(engine.includes("row.modelNames"));
  assert.ok(engine.includes('modelNames.join(" / ")'));
  assert.ok(engine.includes("modelName: liveShopling?.modelName || null"));
  assert.doesNotMatch(engine, /modelName:\s*tracker\?\.productName/);
  assert.doesNotMatch(engine, /modelName:\s*tracker\?\.productName\s*\|\|\s*fallbackProductName/);
  assert.ok(shoplingIdentity.includes('"model_nm"'));
});

test("fast purchase keeps live exact model number first and tracker option as fallback metadata", () => {
  assert.ok(engine.includes("liveShopling?.modelNo || tracker?.modelNumber"));
  assert.ok(engine.includes("tracker?.saleOption"));
  assert.ok(trackerMetadata.includes("modelNumber: string"));
  assert.ok(trackerMetadata.includes("saleOption: string"));
});

test("display-only Shopling identity failure never blocks purchase judgment", () => {
  assert.ok(engine.includes("try {"));
  assert.ok(engine.includes("Display-only Shopling identity lookup must never block the purchase workspace"));
  assert.ok(engine.includes("purchaseWritesEnabled: false"));
  assert.ok(engine.includes("inventoryWritesEnabled: false"));
});

test("B-code cell shows model name model number and option name together without substituting product title for missing model name", () => {
  assert.ok(workspace.includes("B-code · 모델/옵션"));
  assert.ok(workspace.includes("모델명"));
  assert.ok(workspace.includes("모델번호"));
  assert.ok(workspace.includes("옵션명"));
  assert.ok(workspace.includes("row.modelName"));
  assert.ok(workspace.includes("row.modelNo"));
  assert.ok(workspace.includes("row.optionName"));
  assert.doesNotMatch(workspace, /row\.modelName\s*\|\|\s*row\.productName/);
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

test("manual planned quantity can exceed the demand reference but is capped at 9999", () => {
  assert.ok(workspace.includes("const MANUAL_QUANTITY_MAX = 9_999"));
  assert.ok(workspace.includes("function clampManualQuantity"));
  assert.ok(workspace.includes("Math.min(planned, MANUAL_QUANTITY_MAX)"));
  assert.ok(workspace.includes("manual ? MANUAL_QUANTITY_MAX : undefined"));
  assert.ok(workspace.includes("max={manualMax}"));
  assert.doesNotMatch(
    workspace,
    /Math\.min\(planned, quantity\(row\.referenceDemandQuantity\)\)/,
  );
});

test("zero-stock demand reference is a copyable guide rather than the order ceiling", () => {
  assert.ok(workspace.includes("재고0 수요참고"));
  assert.ok(workspace.includes("주문 예정수량"));
  assert.ok(workspace.includes("참고수량 넣기"));
  assert.ok(workspace.includes("이 참고값은 상한이 아니며"));
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

test("fast mode remains no-write until explicit internal draft save and still reports operational coverage", () => {
  assert.ok(engine.includes("automaticPurchaseEnabled: false"));
  assert.ok(engine.includes("purchaseWritesEnabled: false"));
  assert.ok(engine.includes("inventoryWritesEnabled: false"));
  assert.ok(engine.includes("operationalCoverageCount"));
  assert.ok(engine.includes("manualTriageCount"));
  assert.ok(registry.includes("fastPurchaseMvpModule"));
  assert.ok(policy.includes("상한편향 절충값"));
});
