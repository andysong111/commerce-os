import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("purchase V2 engine does not accept or apply MOQ and carton rounding", async () => {
  const source = await read("src/lib/productDecisionEngine/purchaseV2.ts");
  assert.doesNotMatch(source, /\bmoq\b/i);
  assert.doesNotMatch(source, /cartonQuantity/i);
  assert.doesNotMatch(source, /roundUpToCarton|roundDownToCarton/);
  assert.match(source, /recommendedQuantity/);
  assert.match(source, /targetDemand44Days/);
});

test("budget finalization recomputes server-side and stores an immutable fingerprinted snapshot", async () => {
  const finalization = await read("src/lib/purchaseRecommendationFinalization.ts");
  assert.match(finalization, /loadPurchaseRecommendationV2\(\{ cashKrw \}\)/);
  assert.match(finalization, /PURCHASE_RECOMMENDATION_FINALIZED/);
  assert.match(finalization, /reportFingerprint/);
  assert.match(finalization, /commerce_operation_runs/);
  assert.match(finalization, /ignoreDuplicates: true/);
  assert.doesNotMatch(finalization, /reportInput|clientReport|body\.report/);
});

test("China order manager displays the finalized snapshot as its 1688 and close basis", async () => {
  const layout = await read("src/app/china-order-manager/layout.tsx");
  const banner = await read(
    "src/components/china-order-manager/PurchaseV2FinalizedBanner.tsx",
  );
  assert.match(layout, /PurchaseV2FinalizedBanner/);
  assert.match(banner, /1688 주문 · 발주마감 기준/);
  assert.match(banner, /loadFinalizedPurchaseRecommendationV2/);
  assert.match(banner, /확정 발주안 조회/);
});

test("inventory reset and Shopling external status are persisted as separate operation types", async () => {
  const lifecycle = await read("src/lib/inventoryLifecycleLedger.ts");
  const route = await read("src/app/api/inventory-lifecycle/route.ts");
  assert.match(lifecycle, /INVENTORY_STOCKOUT_RESET_EVENT/);
  assert.match(lifecycle, /SHOPLING_INVENTORY_STATUS_SYNC_EVENT/);
  assert.match(route, /재고 기준점은 0으로 확정했습니다/);
  assert.match(route, /Shopling 품절 반영은 별도 작업/);
  assert.match(route, /INVENTORY_RESTORE_POSITIVE_EXACT_STOCK_REQUIRED/);
});
