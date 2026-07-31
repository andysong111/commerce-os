import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pushRoute = new URL(
  "../src/app/api/integrations/price-adjustment/sales-cache/push/route.ts",
  import.meta.url,
);
const readRoute = new URL(
  "../src/app/api/integrations/price-adjustment/sales-cache/route.ts",
  import.meta.url,
);
const storage = new URL(
  "../src/lib/priceAdjustmentSalesCache.ts",
  import.meta.url,
);

test("비공개 발주·단종 추천 Site의 판매추이는 Ops Center 푸시 캐시로 저장한다", async () => {
  const [pushSource, readSource, storageSource] = await Promise.all([
    readFile(pushRoute, "utf8"),
    readFile(readRoute, "utf8"),
    readFile(storage, "utf8"),
  ]);

  assert.match(pushSource, /x-commerce-os-integration-secret/);
  assert.match(pushSource, /MAX_PRODUCTS_PER_PAGE = 250/);
  assert.match(pushSource, /mergePriceAdjustmentSalesCachePage/);
  assert.match(readSource, /PRICE_ADJUSTMENT_SALES_CACHE_REQUIRED/);
  assert.match(readSource, /nextCursor/);
  assert.match(storageSource, /priceAdjustmentSalesCache/);
  assert.match(storageSource, /writeProductLaunchState/);
  assert.match(storageSource, /MAX_SALES_CACHE_PRODUCTS = 25_000/);
});
