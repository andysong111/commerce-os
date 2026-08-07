import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [client, route, page] = await Promise.all([
  readFile("src/lib/productMasterHistoricalReceiptBackfill.ts", "utf8"),
  readFile(
    "src/app/api/product-master/historical-receipt-backfill/diagnose/route.ts",
    "utf8",
  ),
  readFile(
    "src/app/product-master/historical-receipt-backfill/page.tsx",
    "utf8",
  ),
]);

test("Product Master historical receipt client keeps the integration secret server-side", () => {
  assert.match(client, /PRODUCT_MASTER_INTEGRATION_SECRET/);
  assert.match(client, /historical-confirmed-receipts/);
  assert.match(client, /x-commerce-os-integration-secret/);
  assert.match(client, /AbortSignal\.timeout\(60_000\)/);
  assert.doesNotMatch(page, /PRODUCT_MASTER_INTEGRATION_SECRET|x-commerce-os-integration-secret/);
});

test("public Ops proxy exposes diagnosis only and never forwards canary or apply", () => {
  assert.match(route, /mode: "diagnose"/);
  assert.match(route, /proxyMode: "read-only-diagnose"/);
  assert.match(route, /productMasterWritesEnabled: false/);
  assert.doesNotMatch(route, /mode:\s*"canary"|mode:\s*"apply"/);
  assert.doesNotMatch(route, /expectedPlanFingerprint/);
});

test("operator page accepts only the reviewed historical receipt JSON format", () => {
  assert.match(page, /commerce-os-historical-confirmed-receipts-v1/);
  assert.match(page, /type="file"/);
  assert.match(page, /application\/json/);
  assert.match(page, /JSON\.parse\(await file\.text\(\)\)/);
  assert.match(page, /읽기 전용 안전 진단 실행/);
});

test("page clearly separates diagnosis from later canary and full write steps", () => {
  assert.match(page, /이 화면은 진단만 수행/);
  assert.match(page, /실제로 쓰지 않습니다/);
  assert.match(page, /1건\s*카나리/);
  assert.match(page, /안전 전수적재/);
  assert.doesNotMatch(page, /onClick=.*canary|onClick=.*apply/i);
});

test("diagnosis surfaces unresolved identity and ledger conflicts without inventing mappings", () => {
  assert.match(client, /CURRENT_SKU_NOT_FOUND/);
  assert.match(client, /DUPLICATE_ACTIVE_SKU/);
  assert.match(client, /EXISTING_LEDGER_CONFLICT/);
  assert.match(page, /현재 SKU가 없는 과거/);
  assert.match(page, /임의로 새 SKU를 만들지 않습니다/);
  assert.match(page, /연결계획 지문/);
});
