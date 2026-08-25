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

test("SEO 대량등록 클라우드는 상품끼리 3개 병렬, 상품 내부는 기존 STEP API로 분할 실행한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/SeoBulkCloudClient.tsx");
  assert.match(page, /GENERATION_CONCURRENCY = 3/);
  assert.match(page, /REGISTRATION_CONCURRENCY = 3/);
  for (const action of [
    "collect_bulk_source",
    "analyze_identity",
    "discover_keywords",
    "score_keywords",
    "expand_from_passing",
    "filter_prohibited_keywords",
    "generate_title",
    "compose_bulk_final",
  ]) {
    assert.match(page, new RegExp(`action: \\"${action}\\"`));
  }
  assert.doesNotMatch(page, /action: "generate_bulk_final"/);
  assert.match(page, /readableError/);
  assert.match(page, /FINAL RESULT · 검색어 10개/);
  assert.match(page, /Shopling 일괄 대량등록/);
  assert.match(page, /상품명·쇼핑몰 29개·세부 실행정보 펼치기/);
  assert.match(page, /STEP 1~5 · 원장 · 진단 · 기존 세부 엔진 펼치기/);
  assert.match(page, /미완료 FINAL RESULT 재실행/);
  assert.match(page, /operation: "patch_item"/);
  assert.match(page, /\/api\/product-launch-tracker\/shopling-upload/);
});

test("bulk final API는 분할 source/compose와 기존 STEP 1~4 엔진 계약을 함께 유지한다", async () => {
  const route = await source("src/app/api/keyword-engine-elon-lab/route.ts");
  const engine = await source("src/lib/keywordEngineElonBulkFinal.ts");
  assert.match(route, /action === "collect_bulk_source"/);
  assert.match(route, /action === "compose_bulk_final"/);
  assert.match(route, /action === "generate_bulk_final"/);
  assert.match(route, /bulkParallelAvailable: true/);
  assert.match(route, /bulkSegmentedAvailable: true/);
  assert.match(route, /bulkAutoRecoveryAvailable: true/);
  assert.match(engine, /collectKeywordElonBulkSource/);
  assert.match(engine, /composeKeywordElonBulkFinal/);
  assert.match(engine, /collectKeywordElon1688Source/);
  assert.match(engine, /trackerFallbackSource/);
  assert.match(engine, /expandKeywordElonFromPassing/);
  assert.match(engine, /selectKeywordElonStep4Union/);
  assert.match(engine, /filterKeywordElonProhibitedKeywords/);
  assert.match(engine, /buildKeywordElonSeoModelPackage/);
  assert.match(engine, /supplementalSearchKeywords/);
  assert.match(engine, /searchKeywords\.length !== 10/);
  assert.match(engine, /output\.mallTitles\.length !== 29/);
});

test("검색어 부족은 AI+결정형 후보를 STEP4 안전필터에 통과시켜 정확히 10개로 보충한다", async () => {
  const route = await source("src/app/api/keyword-engine-elon-lab/route.ts");
  const recovery = await source("src/lib/keywordEngineElonBulkKeywordRecovery.ts");
  assert.match(route, /generateSafeBulkKeywordSupplements/);
  assert.match(route, /FINAL 검색어가 10개가 아닙니다/);
  assert.match(route, /supplementalSearchKeywords/);
  assert.match(recovery, /KEYWORD_ENGINE_OPENAI_API_KEY/);
  assert.match(recovery, /브랜드명·상표명/);
  assert.match(recovery, /의료기기·치료·진단/);
  assert.match(recovery, /filterKeywordElonProhibitedKeywords/);
  assert.match(recovery, /deterministicSeeds/);
});

test("aborted/failed fetch와 5xx는 키워드 API에 한해서 자동 재시도한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const recovery = await source("src/app/seo-bulk-cloud/SeoBulkFetchRecovery.tsx");
  assert.match(page, /SeoBulkFetchRecovery/);
  assert.match(recovery, /\/api\/keyword-engine-elon-lab/);
  assert.match(recovery, /RETRY_DELAYS_MS = \[0, 700, 1_800, 4_200\]/);
  assert.match(recovery, /408, 425, 429, 500, 502, 503, 504/);
  assert.match(recovery, /commerceSeoBulkRecoveringFetch/);
  assert.doesNotMatch(recovery, /shopling-upload/);
});

test("OPS 기능카드는 단순화된 대량 클라우드를 기본 진입점으로 사용한다", async () => {
  const moduleFile = await source("src/lib/keywordEngineElonLabModule.ts");
  assert.match(moduleFile, /route: "\/seo-bulk-cloud"/);
  assert.match(moduleFile, /여러 상품을 선택/);
  assert.match(moduleFile, /Shopling 일괄 대량등록/);
});
