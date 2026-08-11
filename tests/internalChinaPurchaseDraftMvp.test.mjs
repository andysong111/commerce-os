import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, workspace, route, page, manager, fastActions, trackerMetadata] =
  await Promise.all([
    readFile("src/lib/internalChinaPurchaseDraft.ts", "utf8"),
    readFile(
      "src/components/china-order-manager/InternalChinaPurchaseDraftWorkspace.tsx",
      "utf8",
    ),
    readFile(
      "src/app/api/china-order-manager/drafts/[draftId]/route.ts",
      "utf8",
    ),
    readFile("src/app/china-order-manager/drafts/[draftId]/page.tsx", "utf8"),
    readFile("src/app/china-order-manager/page.tsx", "utf8"),
    readFile(
      "src/components/fast-purchase-mvp/FastPurchaseDraftActions.tsx",
      "utf8",
    ),
    readFile("src/lib/productLaunchPurchaseMetadata.ts", "utf8"),
  ]);

test("internal China draft starts from the existing fast-purchase RESERVED ledger", () => {
  assert.match(engine, /loadChinaOrderLedger/);
  assert.match(engine, /SOURCE_SYSTEM = "fast-purchase-mvp"/);
  assert.match(engine, /row\.sourceRunId === draftId/);
  assert.match(engine, /row\.openQuantity > 0/);
  assert.match(engine, /FAST_PURCHASE_RESERVED/);
});

test("B-code metadata is reused from Product Master tracker and live Shopling model names", () => {
  assert.match(engine, /loadProductPlanningSnapshot/);
  assert.match(engine, /loadProductLaunchPurchaseMetadataByBarcode/);
  assert.match(engine, /loadShoplingCurrentModelSnapshot/);
  assert.match(engine, /trackerUsable\?\.saleOption/);
  assert.match(engine, /trackerUsable\?\.chinaOption/);
  assert.match(engine, /trackerUsable\?\.supplierLink/);
  assert.match(engine, /live\?\.modelName/);
});

test("product launch metadata uses each option B-code supplier link before the product-level fallback", () => {
  assert.match(trackerMetadata, /normalizeSupplierLink\(option\.supplierLink\)/);
  assert.match(trackerMetadata, /fallbackSupplierLink/);
  assert.match(trackerMetadata, /saleOption: text\(option\.saleOption\)/);
  assert.match(trackerMetadata, /chinaOption: text\(option\.chinaOption\)/);
  assert.match(trackerMetadata, /barcode = normalizeBarcode\(option\.barcode\)/);
});

test("tracker B-code metadata is authoritative while old saved blanks remain a fallback", () => {
  assert.match(engine, /function mergeSavedLine/);
  assert.match(engine, /saleOption: baseLine\.saleOption/);
  assert.match(
    engine,
    /chinaOption: baseLine\.chinaOption \|\| text\(saved\.chinaOption\)/,
  );
  assert.match(
    engine,
    /supplierLink: baseLine\.supplierLink \|\| text\(saved\.supplierLink\)/,
  );
  assert.match(engine, /return saved \? mergeSavedLine\(line, saved\) : line/);
});

test("operator prep is persisted in the existing operation ledger without a schema migration", () => {
  assert.match(engine, /INTERNAL_CHINA_PURCHASE_PREP/);
  assert.match(engine, /commerce_operation_runs/);
  assert.match(engine, /resolution=merge-duplicates/);
  assert.match(engine, /source_event_id/);
  assert.match(engine, /externalOrderExecuted: false/);
});

test("reserved quantity and sale option remain source-owned while order-time cost and freight stay editable", () => {
  assert.match(engine, /INTERNAL_CHINA_QUANTITY_LOCKED/);
  assert.match(engine, /type EditableLine = Pick/);
  assert.doesNotMatch(
    engine.match(/type EditableLine = Pick<[\s\S]*?>;/)?.[0] ?? "",
    /saleOption/,
  );
  assert.match(engine, /saleOption: line\.saleOption/);
  assert.match(engine, /supplierLink/);
  assert.match(engine, /unitPriceCny/);
  assert.match(engine, /freightGroupId/);
  assert.match(engine, /domesticChinaFreightCny/);
  assert.match(workspace, /옵션 · \{line\.saleOption \|\| "-"\}/);
  assert.doesNotMatch(
    workspace,
    /updateLine\(line\.barcode,\s*\{\s*saleOption:/,
  );
  assert.match(
    workspace,
    /수량은[\s\S]*RESERVED로 확정되어 이 화면에서는 변경하지 않습니다/,
  );
});

test("exchange input is removed and internal standard cost is system-owned", () => {
  assert.match(engine, /INTERNAL_CHINA_FIXED_KRW_PER_CNY = 230/);
  assert.match(engine, /INTERNAL_CHINA_ORDER_COST_MULTIPLIER/);
  assert.match(engine, /internalOrderCostMultiplier/);
  assert.doesNotMatch(workspace, /적용 환율 KRW\/CNY/);
  assert.match(workspace, /내부기준원가/);
  assert.match(workspace, /실주문 원가 × 내부 주문 수수료율/);
});

test("product name column is removed and B-code model and sale option share one identity cell", () => {
  assert.match(workspace, /B-code \/ 모델 \/ 옵션/);
  assert.doesNotMatch(workspace, /<th className="px-3 py-3">상품명<\/th>/);
  assert.match(workspace, /line\.modelName/);
  assert.match(workspace, /line\.modelNo/);
  assert.match(workspace, /line\.saleOption/);
});

test("actual ORDERED ledger transition requires operator confirmation and mandatory order evidence", () => {
  assert.match(engine, /blockingOrderIssues/);
  assert.match(engine, /위안단가/);
  assert.match(engine, /1688 링크/);
  assert.match(workspace, /중국옵션/);
  assert.match(engine, /status: "ORDERED"/);
  assert.match(engine, /orderedQuantity: line\.quantity/);
  assert.match(workspace, /window\.confirm/);
  assert.match(workspace, /실제로 1688에서/);
  assert.match(workspace, /이 버튼은 1688 주문·결제를 실행하지 않습니다/);
});

test("internal order record never calls 1688 or payment APIs", () => {
  assert.doesNotMatch(engine, /fetch\([^)]*1688|placeOrder|payOrder|checkout/i);
  assert.match(engine, /externalOrderExecuted: false/);
  assert.match(route, /externalOrderExecuted: false/);
});

test("same-origin API supports read save and explicit ordered record", () => {
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function PUT/);
  assert.match(route, /export async function POST/);
  assert.match(route, /MARK_ORDERED/);
});

test("fast purchase and China manager now route to the Ops Center native draft page", () => {
  assert.match(fastActions, /\/china-order-manager\/drafts\//);
  assert.match(fastActions, /Ops Center 중국 주문초안 열기/);
  assert.doesNotMatch(fastActions, /chatgpt\.site|orderManagerUrl/);
  assert.match(manager, /활성 내부 발주 Draft/);
  assert.match(manager, /GPT Site는 운영 경로에서 사용하지 않습니다/);
  assert.match(page, /OPS CENTER NATIVE CHINA ORDER MVP/);
  assert.match(page, /기존 GPT Site의 주문 준비 단계를 대체/);
  assert.match(page, /budgetAudit=\{budgetAudit\}/);
});
