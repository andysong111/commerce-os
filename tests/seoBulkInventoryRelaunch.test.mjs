import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("SEO bulk handoff keeps an active batch and merges later selections instead of replacing them", async () => {
  const handoff = await source("public/product-launch-tracker-app/seo-title-ledger-handoff.js");
  assert.match(handoff, /ACTIVE_BATCH_MAX_AGE_MS = 8 \* 60 \* 60 \* 1000/);
  assert.match(handoff, /function readActiveBatch\(/);
  assert.match(handoff, /function mergeBatchItems\(/);
  assert.match(handoff, /function buildAccumulatedBatch\(/);
  assert.match(handoff, /items: mergedItems/);
  assert.match(handoff, /existing\?\.batchId/);
  assert.match(handoff, /MAX_BATCH_ITEMS = 50/);
});

test("intentional force registration rotates the Shopling self code instead of reusing the original code", async () => {
  const route = await source("src/app/api/product-launch-tracker/shopling-upload/route.ts");
  const retry = await source("src/lib/productLaunchShoplingRetry.ts");
  assert.match(route, /const intentionalRelaunch = input\.force && hasRegisteredProducts/);
  assert.match(route, /SEO_TITLE_INVENTORY_RELAUNCH/);
  assert.match(route, /intentionalRelaunch \|\| duplicateRetry/);
  assert.match(route, /registrationMode: intentionalRelaunch/);
  assert.match(retry, /registrationResetHistory/);
  assert.match(retry, /previousSelfCodeBase/);
  assert.match(retry, /SEO 상품명 재고 재등록/);
});

test("registered products can reserve the next 29 title inventory rows and relaunch as additional Shopling products", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const bridge = await source("src/app/seo-bulk-cloud/SeoBulkRelaunchBridge.tsx");
  const finalize = await source("src/app/api/seo-title-dispatch/finalize/route.ts");
  assert.match(page, /SeoBulkRelaunchBridge/);
  assert.match(bridge, /INVENTORY_SYNC_API = "\/api\/seo-title-ledger\/sync"/);
  assert.match(bridge, /action: "reserve"/);
  assert.match(bridge, /rounds: 1/);
  assert.match(bridge, /plan\.length !== 29/);
  assert.match(bridge, /registrationResetHistory/);
  assert.match(bridge, /force: true/);
  assert.match(bridge, /finalizeReservation\(reservation, true\)/);
  assert.match(bridge, /partial_failure/);
  assert.match(finalize, /finalize_seo_title_reservation/);
  assert.match(finalize, /inventoryDisposition: success \? "used" : "review"/);
});
