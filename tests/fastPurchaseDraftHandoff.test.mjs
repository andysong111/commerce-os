import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [handoff, route, actions] = await Promise.all([
  readFile("src/lib/fastPurchaseDraftHandoff.ts", "utf8"),
  readFile("src/app/api/fast-purchase/drafts/queue/route.ts", "utf8"),
  readFile("src/components/fast-purchase-mvp/FastPurchaseDraftActions.tsx", "utf8"),
]);

test("handoff reads an existing internal Draft and reuses the established purchase-plan queue", () => {
  assert.match(handoff, /loadFastPurchaseInternalDrafts/);
  assert.match(handoff, /loadProductPlanningSnapshot/);
  assert.match(handoff, /enqueuePurchasePlanDraft/);
  assert.match(handoff, /sourceRunId: draftId/);
});

test("only an open RESERVED draft that has not started ordering can be queued", () => {
  assert.match(handoff, /draft\.openQuantity <= 0/);
  assert.match(handoff, /draft\.orderedQuantity > 0 \|\| draft\.receivedQuantity > 0/);
  assert.match(handoff, /line\.status !== "RESERVED" \|\| line\.openQuantity <= 0/);
  assert.match(handoff, /FAST_PURCHASE_HANDOFF_ALREADY_PROGRESSING/);
});

test("China draft keeps actual supplier pricing as a later review step", () => {
  assert.match(handoff, /unitCostKrw: 0/);
  assert.match(handoff, /externalOrderExecuted: false/);
  assert.doesNotMatch(handoff, /orderedOn1688|unitPriceCny|payment/i);
});

test("LEGACY placeholder model numbers are never handed to China order management", () => {
  assert.match(handoff, /function handoffModelNumber/);
  assert.match(handoff, /\^LEGACY-/i);
  assert.match(handoff, /return barcode/);
  assert.match(handoff, /modelNumber: handoffModelNumber\(profile\?\.modelNo, line\.barcode\)/);
});

test("handoff deep link carries the exact internal draft run id", () => {
  assert.match(handoff, /purchaseDraftRun/);
  assert.match(handoff, /china-order-manager\.andy123df23\.chatgpt\.site/);
  assert.match(actions, /중국 주문초안 열기/);
});

test("handoff API is same-origin only", () => {
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(route, /FAST_PURCHASE_HANDOFF_UNAUTHORIZED/);
  assert.match(route, /queueFastPurchaseDraftForChina/);
});

test("operator gets an explicit no-order confirmation before queue handoff", () => {
  assert.match(actions, /window\.confirm/);
  assert.match(actions, /중국 발주·입고 관리의 주문초안으로 전달할까요/);
  assert.match(actions, /아직 1688 주문·결제는 실행하지 않습니다/);
  assert.match(actions, /method: "POST"/);
  assert.match(actions, /\/api\/fast-purchase\/drafts\/queue/);
});
