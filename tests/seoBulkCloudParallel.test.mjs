import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("상품출시 진행관리 SEO handoff는 단건 제한 없이 최대 50개 배치를 넘긴다", async () => {
  const handoff = await source("public/product-launch-tracker-app/seo-title-ledger-handoff.js");
  assert.match(handoff, /MAX_BATCH_ITEMS = 50/);
  assert.match(handoff, /commerceOs\.seoBulkCloud\.batch\.v1/);
  assert.match(handoff, /\/seo-bulk-cloud/);
  assert.match(handoff, /mapLimit\(selectedIds, 8/);
  assert.doesNotMatch(handoff, /상품 한 개씩 원장을 생성/);
  assert.doesNotMatch(handoff, /selectedIds\.length !== 1/);
});

test("SEO 대량등록 클라우드는 FINAL 생성과 Shopling 등록을 각각 병렬 3개로 실행한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/SeoBulkCloudClient.tsx");
  assert.match(page, /GENERATION_CONCURRENCY = 3/);
  assert.match(page, /REGISTRATION_CONCURRENCY = 3/);
  assert.match(page, /action: "generate_bulk_final"/);
  assert.match(page, /FINAL RESULT · 검색어 10개/);
  assert.match(page, /Shopling 일괄 대량등록/);
  assert.match(page, /상품명·쇼핑몰 29개·세부 실행정보 펼치기/);
  assert.match(page, /STEP 1~5 · 원장 · 진단 · 기존 세부 엔진 펼치기/);
  assert.match(page, /operation: "patch_item"/);
  assert.match(page, /\/api\/product-launch-tracker\/shopling-upload/);
});

test("bulk final API는 기존 STEP 1~4 엔진과 10개 검색어·29개 상품명 계약을 재사용한다", async () => {
  const route = await source("src/app/api/keyword-engine-elon-lab/route.ts");
  const engine = await source("src/lib/keywordEngineElonBulkFinal.ts");
  assert.match(route, /action === "generate_bulk_final"/);
  assert.match(route, /bulkParallelAvailable: true/);
  assert.match(engine, /collectKeywordElon1688Source/);
  assert.match(engine, /trackerFallbackSource/);
  assert.match(engine, /expandKeywordElonFromPassing/);
  assert.match(engine, /selectKeywordElonStep4Union/);
  assert.match(engine, /filterKeywordElonProhibitedKeywords/);
  assert.match(engine, /buildKeywordElonSeoModelPackage/);
  assert.match(engine, /commonSearchKeywords\.length !== 10/);
  assert.match(engine, /mallTitles\.length !== 29/);
});

test("OPS 기능카드는 단순화된 대량 클라우드를 기본 진입점으로 사용한다", async () => {
  const moduleFile = await source("src/lib/keywordEngineElonLabModule.ts");
  assert.match(moduleFile, /route: "\/seo-bulk-cloud"/);
  assert.match(moduleFile, /여러 상품을 선택/);
  assert.match(moduleFile, /Shopling 일괄 대량등록/);
});
