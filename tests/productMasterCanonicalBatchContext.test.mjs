import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile("src/lib/productMasterCanonicalSync.ts", "utf8");

test("dependent Product Master batches carry their referenced SKU context in the same request", () => {
  assert.ok(source.includes('type DependentCanonicalKey = "listingMappings" | "receiptCosts"'));
  assert.ok(source.includes("function dependentSkuContext("));
  assert.ok(source.includes('key === "listingMappings" || key === "receiptCosts"'));
  assert.ok(source.includes("requestPayload.skus = dependentSkuContext(key, batch, skuById)"));
  assert.ok(source.includes("body: JSON.stringify(requestPayload)"));
});

test("missing dependent SKU context fails closed instead of writing an orphan foreign key", () => {
  assert.ok(source.includes("PRODUCT_MASTER_DEPENDENT_SKU_CONTEXT_MISSING"));
  assert.ok(source.includes("const skuById = new Map("));
  assert.ok(source.includes("built.payload.skus.map((sku) => [sku.id, sku] as const)"));
});

test("canonical SKU context fix protects both listing and finalized receipt-cost batches", () => {
  assert.ok(source.includes('["listingMappings", built.payload.listingMappings]'));
  assert.ok(source.includes('["receiptCosts", built.payload.receiptCosts]'));
  assert.equal(source.includes("body: JSON.stringify({ [key]: batch })"), false);
});
