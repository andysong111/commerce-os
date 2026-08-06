import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [client, page] = await Promise.all([
  readFile("src/lib/productMasterCatalogReadiness.ts", "utf8"),
  readFile("src/app/product-master/page.tsx", "utf8"),
]);

test("Ops Center reads Product Master catalog readiness with the existing integration secret", () => {
  assert.match(client, /PRODUCT_MASTER_BASE_URL/);
  assert.match(client, /PRODUCT_MASTER_INTEGRATION_SECRET/);
  assert.match(client, /\/api\/integrations\/catalog-readiness/);
  assert.match(client, /x-commerce-os-integration-secret/);
  assert.match(client, /AbortSignal\.timeout\(30_000\)/);
  assert.match(client, /cache: "no-store"/);
});

test("Product Master page is an internal readiness dashboard instead of an external redirect", () => {
  assert.doesNotMatch(page, /redirect\(/);
  assert.match(page, /상품마스터/);
  assert.match(page, /Shopling 매출 적재 준비 완료/);
  assert.match(page, /0개·미확인으로 시작/);
  assert.match(page, /초기재고 미확인은 의도된 시작 상태/);
  assert.match(page, /loadProductMasterCatalogReadiness/);
});

test("readiness dashboard separates blocking catalog work from informational inventory state", () => {
  assert.match(page, /summary\.blockerSkuCount/);
  assert.match(page, /summary\.reviewSkuCount/);
  assert.match(page, /summary\.inventoryConfirmedCount/);
  assert.match(page, /summary\.inventoryUnverifiedCount/);
  assert.match(page, /readyForShoplingSalesImport/);
  assert.match(page, /판매원장 적재 보류/);
});

test("readiness client and page never print or mutate integration secrets or business data", () => {
  assert.doesNotMatch(client, /console\.log/);
  assert.doesNotMatch(client, /export async function (?:POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(page, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(page, /1688|샵플링 가격변경|입고확정 실행/i);
});
