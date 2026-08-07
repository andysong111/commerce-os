import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const server = await readFile(
  new URL("../src/lib/productMasterShoplingMappingApply.ts", import.meta.url),
  "utf8",
);
const route = await readFile(
  new URL(
    "../src/app/api/product-master/shopling-diagnostic/apply/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const client = await readFile(
  new URL(
    "../src/app/product-master/shopling-diagnostic/apply/ShoplingMappingApplyControl.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("mapping apply writes only through the Product Master barcode-ledger integration", () => {
  assert.match(server, /\/api\/integrations\/barcode-ledgers/);
  assert.match(server, /listingMappings/);
  assert.doesNotMatch(server, /SHOPLING_PRODUCTS_API_URL/);
  assert.doesNotMatch(server, /SHOPLING_ORDERS_API_URL/);
  assert.doesNotMatch(server, /SHOPLING_CLAIMS_API_URL/);
});

test("full mapping apply is impossible before a verified canary", () => {
  assert.match(server, /PRODUCT_MASTER_MAPPING_CANARY_REQUIRED/);
  assert.match(server, /verified:\s*true/);
  assert.match(server, /readCanaryOperation/);
  assert.match(client, /status\.canaryVerified/);
});

test("same-origin browser authorization protects the write API", () => {
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(route, /PRODUCT_MASTER_SHOPLING_MAPPING_UNAUTHORIZED/);
});

test("mapping writes are bounded, idempotent, and verified by a fresh planning snapshot", () => {
  assert.match(server, /APPLY_BATCH_SIZE = 500/);
  assert.match(server, /loadProductPlanningSnapshot\(\)/);
  assert.match(server, /verifyRows/);
  assert.match(server, /retryIsIdempotent: true/);
});

test("operator UI explains that Shopling price inventory and procurement are untouched", () => {
  assert.match(client, /Shopling 자체 데이터와 가격·재고·발주는 변경하지 않습니다/);
  assert.match(client, /1건 카나리 적용 및 재검증/);
});
