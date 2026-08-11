import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, workspace, route, page, manager, fastActions] = await Promise.all([
  readFile("src/lib/internalChinaPurchaseDraft.ts", "utf8"),
  readFile(
    "src/components/china-order-manager/InternalChinaPurchaseDraftWorkspace.tsx",
    "utf8",
  ),
  readFile("src/app/api/china-order-manager/drafts/[draftId]/route.ts", "utf8"),
  readFile("src/app/china-order-manager/drafts/[draftId]/page.tsx", "utf8"),
  readFile("src/app/china-order-manager/page.tsx", "utf8"),
  readFile("src/components/fast-purchase-mvp/FastPurchaseDraftActions.tsx", "utf8"),
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

test("saved blank purchase metadata does not hide tracker data added later", () => {
  assert.match(engine, /function mergeSavedLine/);
  assert.match(engine, /saleOption: text\(saved\.saleOption\) \|\| baseLine\.saleOption/);
  assert.match(engine, /chinaOption: text\(saved\.chinaOption\) \|\| baseLine\.chinaOption/);
  assert.match(engine, /supplierLink: text\(saved\.supplierLink\) \|\| baseLine\.supplierLink/);
  assert.match(engine, /return saved \? mergeSavedLine\(line, saved\) : line/);
});

test("operator prep is persisted in the existing operation ledger without a schema migration", () => {
  assert.match(engine, /INTERNAL_CHINA_PURCHASE_PREP/);
  assert.match(engine, /commerce_operation_runs/);
  assert.match(engine, /resolution=merge-duplicates/);
  assert.match(engine, /source_event_id/);
  assert.match(engine, /externalOrderExecuted: false/);
});

test("reserved quantity remains locked while price freight option and supplier metadata are editable", () => {
  assert.match(engine, /INTERNAL_CHINA_QUANTITY_LOCKED/);
  assert.match(engine, /supplierLink/);
  assert.match(engine, /unitPriceCny/);
  assert.match(engine, /freightGroupId/);
  assert.match(engine, /domesticChinaFreightCny/);
  assert.match(workspace, /수량은 빠른 발주안에서 RESERVED로 확정된 값이므로 여기서는 변경하지 않습니다/);
});

test("actual ORDERED ledger transition requires operator confirmation and mandatory order evidence", () => {
  assert.match(engine, /blockingOrderIssues/);
  assert.match(engine, /위안단가/);
  assert.match(engine, /1688 링크/);
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
});
