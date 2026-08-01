import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("stores purchase drafts in the existing tracker state with idempotent run keys", async () => {
  const queue = await source("../src/lib/purchasePlanDraftQueue.ts");
  assert.match(queue, /purchasePlanDraftQueue/);
  assert.match(queue, /queue\.entries\[input\.sourceRunId\]/);
  assert.match(queue, /existing\?\.status === "PENDING"/);
  assert.match(queue, /existing\?\.status === "IMPORTED"/);
  assert.match(queue, /writeProductLaunchState/);
});

test("merges separate row retries into the same monthly draft instead of replacing prior rows", async () => {
  const queue = await source("../src/lib/purchasePlanDraftQueue.ts");
  assert.match(queue, /mergeItems\(existing\?\.items \?\? \[\], input\.items\)/);
  assert.match(queue, /existing\.forEach\(\(item\) => byBarcode\.set\(item\.barcode, item\)\)/);
  assert.match(queue, /incoming\.forEach\(\(item\) => byBarcode\.set\(item\.barcode, item\)\)/);
  assert.match(queue, /batchId: existing\?\.batchId \?\? null/);
});

test("separates producer and consumer integration secrets with deployed fallbacks", async () => {
  const [push, pending, ack] = await Promise.all([
    source("../src/app/api/integrations/purchase-plan-draft-queue/push/route.ts"),
    source("../src/app/api/integrations/purchase-plan-draft-queue/pending/route.ts"),
    source("../src/app/api/integrations/purchase-plan-draft-queue/ack/route.ts"),
  ]);
  assert.match(push, /PRODUCT_DECISION_TO_CHINA_ORDER_SECRET/);
  assert.match(push, /PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET/);
  assert.match(push, /CHINA_ORDER_MANAGER_INTEGRATION_SECRET/);
  assert.match(push, /SYNC_JOB_SECRET/);
  assert.match(pending, /CHINA_ORDER_MANAGER_INTEGRATION_SECRET/);
  assert.match(ack, /CHINA_ORDER_MANAGER_INTEGRATION_SECRET/);
  assert.match(push, /x-commerce-os-integration-secret/);
});

test("relay only queues drafts and never executes ordering or stock mutations", async () => {
  const files = await Promise.all([
    source("../src/lib/purchasePlanDraftQueue.ts"),
    source("../src/app/api/integrations/purchase-plan-draft-queue/push/route.ts"),
  ]);
  const combined = files.join("\n");
  assert.doesNotMatch(combined, /orderedOn1688\s*:\s*true/);
  assert.doesNotMatch(combined, /입고확정|재고반영|결제 실행/);
  assert.match(combined, /status: "PENDING"/);
});
