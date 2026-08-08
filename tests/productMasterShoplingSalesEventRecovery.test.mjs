import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [sync, cron] = await Promise.all([
  readFile("src/lib/productMasterShoplingSalesEventSync.ts", "utf8"),
  readFile("src/app/api/cron/product-master-shopling-sales-events/route.ts", "utf8"),
]);

test("sales-event collection retries a failed range before terminal failure", () => {
  assert.match(sync, /SALES_EVENT_STEP_FAILURE/);
  assert.match(sync, /MAX_STEP_ATTEMPTS = 3/);
  assert.match(sync, /storeStepFailure/);
  assert.match(sync, /priorAttempts\.length \+ 1/);
  assert.match(sync, /attempt >= MAX_STEP_ATTEMPTS/);
});

test("request lineage preserves the same analysis instant while shrinking 30 to 7 to 2 days", () => {
  assert.match(sync, /SALES_EVENT_DEFAULT_CHUNK_DAYS = 30/);
  assert.match(sync, /SALES_EVENT_FALLBACK_CHUNK_DAYS = 7/);
  assert.match(sync, /SALES_EVENT_MINIMUM_CHUNK_DAYS = 2/);
  assert.match(sync, /supersedesRequestId/);
  assert.match(sync, /analysisAsOf: current\.analysisAsOf/);
  assert.match(sync, /recoverProductMasterShoplingSalesEventSyncRequest/);
});

test("cron can recover terminal Shopling reads but never runs Product Master canary or full", () => {
  assert.match(cron, /recoverProductMasterShoplingSalesEventSyncRequest/);
  assert.match(cron, /current\.state === "FAILED"/);
  assert.match(cron, /30일[\s\S]*7일/);
  assert.match(cron, /7일[\s\S]*2일/);
  assert.doesNotMatch(cron, /applyProductMasterShoplingSalesEvents/);
});
