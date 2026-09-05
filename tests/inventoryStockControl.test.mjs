import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function sources() {
  const [inventory, resetRoute, syncRoute, panel, finalization] = await Promise.all([
    readFile("src/lib/inventoryStockControl.ts", "utf8"),
    readFile("src/app/api/inventory-stock-control/route.ts", "utf8"),
    readFile("src/app/api/inventory-stock-control/sync/route.ts", "utf8"),
    readFile(
      "src/components/china-order-manager/InventoryStockControlPanel.tsx",
      "utf8",
    ),
    readFile("src/lib/purchaseRecommendationFinalization.ts", "utf8"),
  ]);
  return { inventory, resetRoute, syncRoute, panel, finalization };
}

test("stockout reset establishes zero and counts only post-reset receipt deltas and sales", async () => {
  const { inventory } = await sources();
  assert.match(inventory, /INVENTORY_STOCKOUT_RESET_EVENT/);
  assert.match(inventory, /point\.occurredAt >= reset\.occurredAt/);
  assert.match(inventory, /event\.occurredAt >= reset\.occurredAt/);
  assert.match(inventory, /boundedReceived - previousReceived/);
  assert.match(inventory, /quantityOnHand = Math\.max\(0, quantityOnHand \+ point\.delta\)/);
  assert.match(inventory, /exactInventoryQuantity: transition\.quantityOnHand/);
});

test("completed canonical read covers a reset through analysisAsOf even when no post-reset sale exists", async () => {
  const { inventory } = await sources();
  const snapshot = await readFile(
    "src/lib/stage8CanonicalSalesEventSnapshot.ts",
    "utf8",
  );
  assert.match(
    snapshot,
    /const coverageEndAt = status\.analysisAsOf \?\? orderedDates\.at\(-1\) \?\? null/,
  );
  assert.match(snapshot, /coverageEndAt,/);
  assert.match(inventory, /coverageEndAt >= reset\.occurredAt/);
  assert.doesNotMatch(
    snapshot,
    /coverageEndAt: orderedDates\.at\(-1\) \?\? null/,
  );
});

test("zero inventory requests stockout and confirmed inbound requests on-sale recovery", async () => {
  const { inventory, syncRoute } = await sources();
  assert.match(
    inventory,
    /quantityOnHand > 0 \? "ON_SALE" : "SOLD_OUT"/,
  );
  assert.match(syncRoute, /A6_OPTION_STATUS/);
  assert.match(syncRoute, /A22_OPTION_TRANSMIT/);
  assert.match(syncRoute, /A21_PRODUCT_SALE_STATUS/);
  assert.match(
    syncRoute,
    /row\.productKind === "OPTION"[\s\S]*A22_OPTION_TRANSMIT[\s\S]*A21_PRODUCT_SALE_STATUS/,
  );
});

test("single products require a model number before A21 execution", async () => {
  const { inventory, panel } = await sources();
  assert.match(inventory, /reset\.productKind === "SINGLE" && !modelNo/);
  assert.match(panel, /productKind === "SINGLE" && !modelNo\.trim\(\)/);
  assert.match(panel, /단품은 A22가 아니라 A21 판매상태 송신을 사용합니다/);
});

test("external Shopling write is separated from the physical stockout fact", async () => {
  const { inventory, resetRoute, syncRoute } = await sources();
  assert.match(resetRoute, /RESET_ZERO/);
  assert.match(resetRoute, /storeInventoryOperation/);
  assert.match(syncRoute, /SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE/);
  assert.match(inventory, /syncNeeded: !succeededForDesired/);
  assert.match(inventory, /STARTED\/UNCERTAIN 상태라 중복 실행을 차단/);
  assert.doesNotMatch(resetRoute, /a\.shopling\.co\.kr/);
});

test("budget finalization is an immutable fingerprinted snapshot", async () => {
  const { finalization } = await sources();
  assert.match(finalization, /PURCHASE_RECOMMENDATION_FINALIZED/);
  assert.match(finalization, /calculationFingerprint/);
  assert.match(finalization, /ignoreDuplicates: true/);
  assert.match(finalization, /purchase-finalized:/);
  assert.match(finalization, /loadLatestPurchaseRecommendationFinalization/);
  assert.match(finalization, /boundedCycleMultiplier = Math\.min\(1\.1, Math\.max\(0\.9, rawRatio\)\)/);
});

test("stock control APIs remain same-origin protected", async () => {
  const { resetRoute, syncRoute } = await sources();
  assert.match(resetRoute, /isSameOriginOpsRequest/);
  assert.match(syncRoute, /isSameOriginOpsRequest/);
  assert.doesNotMatch(resetRoute, /serviceAuthorized/);
  assert.doesNotMatch(syncRoute, /serviceAuthorized/);
});
