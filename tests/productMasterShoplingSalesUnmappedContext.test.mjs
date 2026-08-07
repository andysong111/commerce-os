import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  "src/app/api/product-master/shopling-sales-backfill/unmapped-context/route.ts",
  "utf8",
);

test("unmapped context is same-origin and read-only", () => {
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(route, /loadProductMasterShoplingSalesStatus/);
  assert.match(route, /loadProductPlanningSnapshot/);
  assert.match(route, /export async function GET/);
  assert.match(route, /businessWritesPerformed:\s*false/);
  assert.doesNotMatch(route, /export async function POST/);
  assert.doesNotMatch(route, /barcode-ledgers|pushSales|ShoplingReadClient/);
});

test("unmapped context compares barcode option and goods identities", () => {
  assert.match(route, /managedCode/);
  assert.match(route, /barcodeExact/);
  assert.match(route, /optionId/);
  assert.match(route, /goodsKeys/);
  assert.match(route, /unitsPerOrder/);
  assert.match(route, /skuActive/);
});
