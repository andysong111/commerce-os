import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("SEO 대량등록 화면은 등록완료 상품 원본이 아니라 실행회차 카드만 보관한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const client = await source("src/app/seo-bulk-cloud/SeoBulkRunCloudClient.tsx");
  assert.match(page, /SeoBulkRunCloudClient/);
  assert.doesNotMatch(page, /SeoBulkCompletionArchiveBridge/);
  assert.match(client, /등록완료 카드 보관/);
  assert.match(client, /archiveRuns/);
  assert.match(client, /item\.runId/);
  assert.doesNotMatch(client, /archive_items/);
  assert.doesNotMatch(client, /archivedAt: true/);
});

test("등록회차 이력은 상품의 shoplingRegistrationHistory에 남아 이미지 회전과 감사 이력을 유지한다", async () => {
  const client = await source("src/app/seo-bulk-cloud/SeoBulkRunCloudClient.tsx");
  const shopling = await source("src/lib/productLaunchTrackerShopling.ts");
  assert.match(client, /shoplingRegistrationHistory/);
  assert.match(client, /seoRunId: row\.runId/);
  assert.match(client, /registrationType: hasExistingGoods \? "seo_inventory_append" : "seo_run_initial"/);
  assert.match(shopling, /registrationType\) === "seo_inventory_append"/);
  assert.match(shopling, /imageRotationRound/);
});

test("상품명 재고 원장은 기존 launch ledger 구조를 유지해 과거 운영 데이터와 호환된다", async () => {
  const sync = await source("src/lib/seoTitleBulkInventorySync.ts");
  assert.match(sync, /ledgerKey = `launch:\$\{normalizedId\}`/);
  assert.match(sync, /findSeoTitleLedgerByKey/);
  assert.match(sync, /on_conflict=ledger_id,title_fingerprint/);
  assert.match(sync, /existingTitleFingerprints/);
  assert.match(sync, /existingSemanticFingerprints/);
});
