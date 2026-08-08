import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createSalesEventSyncRequestPlan,
} from "../src/lib/productMasterShoplingSalesEventSync.ts";

const [sync, route, cron, vercel] = await Promise.all([
  readFile("src/lib/productMasterShoplingSalesEventSync.ts", "utf8"),
  readFile("src/app/api/product-master/shopling-sales-events/route.ts", "utf8"),
  readFile("src/app/api/cron/product-master-shopling-sales-events/route.ts", "utf8"),
  readFile("vercel.json", "utf8"),
]);

test("360-day request pins one Product Master planning fingerprint", () => {
  const request = createSalesEventSyncRequestPlan(
    "request-1",
    {
      generatedAt: "2026-08-08T00:00:00.000Z",
      contentFingerprint: `sha256:${"a".repeat(64)}`,
      products: [{ skuId: "sku:BAA1-1", barcode: "BAA1-1", productName: "x", listings: [] }],
    },
    "2026-08-08T12:00:00.000Z",
  );
  assert.equal(request.planningContentFingerprint, `sha256:${"a".repeat(64)}`);
  assert.equal(request.analysisAsOf, "2026-08-08T12:00:00.000Z");
  assert.ok(request.ranges.length >= 12);
  assert.equal(request.ranges[0].start, request.analysisStartDate);
  assert.equal(request.ranges.at(-1).end, request.analysisEndDate);
});

test("collection is read-only and business write waits for explicit canary/full", () => {
  assert.match(sync, /ShoplingReadClient/);
  assert.match(sync, /mode: "canary" \| "full"/);
  assert.match(sync, /SALES_EVENT_CANARY_REQUIRED/);
  assert.match(sync, /SALES_EVENT_PLAN_CHANGED/);
  assert.match(route, /confirmation/);
  assert.match(route, /CANARY/);
  assert.match(route, /FULL/);
});

test("Product Master storage migration gate is preserved before any event write", () => {
  const storageCheck = sync.indexOf("const storage = await productMasterSnapshot(request)");
  const eventPost = sync.indexOf("await postProductMasterEvents(batch)");
  assert.ok(storageCheck >= 0);
  assert.ok(eventPost > storageCheck);
  assert.match(sync, /storageReady: false/);
  assert.match(sync, /migration/);
});

test("cron only collects and never performs canary or full business writes", () => {
  assert.match(cron, /runProductMasterShoplingSalesEventSyncStep/);
  assert.doesNotMatch(cron, /applyProductMasterShoplingSalesEvents/);
  assert.match(vercel, /\/api\/cron\/product-master-shopling-sales-events/);
  assert.match(vercel, /"schedule": "\* \* \* \* \*"/);
});

test("event source and wire format match Product Master contract", () => {
  assert.match(sync, /commerce-os-sales-events-v1|PRODUCT_MASTER_SALES_EVENT_FORMAT/);
  assert.match(sync, /shopling_orders_event_v1|PRODUCT_MASTER_SALES_EVENT_SOURCE/);
  assert.match(sync, /APPLY_BATCH_SIZE = 5_000/);
  assert.doesNotMatch(sync, /1688|price change|Shopling write/i);
});
