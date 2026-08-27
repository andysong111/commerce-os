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
  assert.match(engine, /composeKeywordElonSafeMallTitles/);
  assert.doesNotMatch(engine, /diversifyKeywordElonMallTitles/);
  assert.match(engine, /supplementalSearchKeywords/);
  assert.match(engine, /searchKeywords\.length !== 10/);
  assert.match(engine, /mallTitles\.length !== 29/);
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

test("aborted/failed fetch와 일시적 5xx는 키워드 API에서만 제한 병렬로 자동 재시도한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const recovery = await source("src/app/seo-bulk-cloud/SeoBulkFetchRecovery.tsx");
  assert.match(page, /SeoBulkFetchRecovery/);
  assert.match(recovery, /\/api\/keyword-engine-elon-lab/);
  assert.match(recovery, /RETRY_DELAYS_MS = \[0, 800, 2_000, 4_500, 8_000, 14_000, 22_000\]/);
  assert.match(recovery, /408, 425, 429, 502, 503, 504/);
  assert.match(recovery, /MAX_CONCURRENT_KEYWORD_REQUESTS = 2/);
  assert.match(recovery, /TRANSIENT_500_PATTERN/);
  assert.match(recovery, /operation was aborted/);
  assert.match(recovery, /isRetryableResponse/);
  assert.match(recovery, /commerceSeoBulkRecoveringFetch/);
  assert.doesNotMatch(recovery, /shopling-upload/);
});

test("OPS 기능카드는 단순화된 대량 클라우드를 기본 진입점으로 사용한다", async () => {
  const moduleFile = await source("src/lib/keywordEngineElonLabModule.ts");
  assert.match(moduleFile, /route: "\/seo-bulk-cloud"/);
  assert.match(moduleFile, /여러 상품을 선택/);
  assert.match(moduleFile, /Shopling 일괄 대량등록/);
});

test("SEO 대량등록 handoff는 두 번 나눠 선택해도 미등록 배치를 덮어쓰지 않고 합친다", async () => {
  const handoff = await source("public/product-launch-tracker-app/seo-title-ledger-handoff.js");
  assert.match(handoff, /readPendingBatch/);
  assert.match(handoff, /mergePendingItems/);
  assert.match(handoff, /previousBatch\?\.items/);
  assert.match(handoff, /text\(previousBatch\?\.batchId\)/);
  assert.match(handoff, /아직 Shopling 일괄등록하지 않은 기존 상품과 합치면/);
  assert.doesNotMatch(handoff, /const batchId = globalThis\.crypto\?\.randomUUID\?\.\(\) \|\| `seo-bulk-/);
});

test("SEO 대량등록 버튼을 반복해서 눌러도 같은 창을 재사용하고 동일 배치는 재로딩하지 않는다", async () => {
  const handoff = await source("public/product-launch-tracker-app/seo-title-ledger-handoff.js");
  const windowBridge = await source("src/app/seo-bulk-cloud/SeoBulkWindowBridge.tsx");
  const page = await source("src/app/seo-bulk-cloud/page.tsx");

  assert.match(handoff, /SEO_BULK_WINDOW_NAME = "commerce-os-seo-bulk-cloud"/);
  assert.match(handoff, /window\.open\("", SEO_BULK_WINDOW_NAME\)/);
  assert.doesNotMatch(handoff, /window\.open\(target, "_blank"\)/);
  assert.match(handoff, /batchItemSignature/);
  assert.match(handoff, /SEO_BULK_REVISION_PARAM/);
  assert.match(handoff, /seoBulkWindowRevision\(opened\) === revision/);
  assert.match(handoff, /현재 SEO 대량등록 클라우드가 생성 중입니다/);
  assert.match(windowBridge, /window\.name = SEO_BULK_WINDOW_NAME/);
  assert.match(page, /SeoBulkWindowBridge/);
});

test("기등록 완료 상품은 SEO 클라우드 목록에서 숨기지 않고 기등록 상태로 계속 표시한다", async () => {
  const bridge = await source("src/app/seo-bulk-cloud/SeoBulkCompletionArchiveBridge.tsx");
  const client = await source("src/app/seo-bulk-cloud/SeoBulkCloudClient.tsx");

  assert.match(bridge, /scanCompletedArticles/);
  assert.match(bridge, /data-seo-bulk-goods-key-complete/);
  assert.doesNotMatch(bridge, /style\.display\s*=\s*"none"/);
  assert.doesNotMatch(bridge, /style\.removeProperty\("display"\)/);
  assert.match(client, /shoplingStatus: goodsKeys\.length \? "already_registered" : "idle"/);
  assert.match(client, /goods_key \$\{goodsKeys\.length\}개 등록됨/);
});

test("보관함 이동이 끝난 상품은 SEO 대량등록 localStorage 배치에서도 자동 제거한다", async () => {
  const bridge = await source("src/app/seo-bulk-cloud/SeoBulkCompletionArchiveBridge.tsx");
  assert.match(bridge, /loadArchivedItemIds/);
  assert.match(bridge, /Boolean\(text\(item\.archivedAt\)\)/);
  assert.match(bridge, /pruneAlreadyArchived/);
  assert.match(bridge, /pruneBatchItems\(archivedIds\)/);
  assert.match(bridge, /window\.location\.reload\(\)/);
});

test("기등록 상품은 상품명 재고 29개를 예약한 뒤 새 자사상품코드로 force 추가등록하고 실패 시 원상복구한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const bridge = await source("src/app/seo-bulk-cloud/SeoBulkInventoryReregisterBridge.tsx");
  const finalize = await source("src/app/api/seo-title-dispatch/finalize/route.ts");
  assert.match(page, /SeoBulkInventoryReregisterBridge/);
  assert.match(bridge, /executionPlan\.length !== 29/);
  assert.match(bridge, /상품명 재고 29개/);
  assert.match(bridge, /newSelfCodeBase = nextSelfCode/);
  assert.match(bridge, /force: true/);
  assert.match(bridge, /shoplingRegistrationHistory/);
  assert.match(bridge, /shoplingProducts: previousProducts/);
  assert.match(bridge, /seoFinal: previousSeoFinal/);
  assert.match(bridge, /selfCodeBase: previousSelfCodeBase/);
  assert.match(bridge, /success: true/);
  assert.match(bridge, /success: false/);
  assert.match(finalize, /finalize_seo_title_reservation/);
  assert.match(finalize, /inventoryConsumed: success/);
});

test("SEO 대량등록은 6개 goods_key 후처리의 pending/failed 상태를 백그라운드에서 자동 재확인한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const recovery = await source("src/app/seo-bulk-cloud/SeoBulkMallSeoRecoveryBridge.tsx");

  assert.match(page, /SeoBulkMallSeoRecoveryBridge/);
  assert.match(recovery, /CHECK_INTERVAL_MS = 6000/);
  assert.match(recovery, /EXPECTED_GOODS_KEY_COUNT = 6/);
  assert.match(recovery, /EXPECTED_MALL_TITLE_COUNT = 29/);
  assert.match(recovery, /\["pending", "running", "failed"\]/);
  assert.match(recovery, /\/api\/product-launch-tracker\/shopling-mall-seo/);
  assert.match(recovery, /MAX_CONCURRENCY = 3/);
});
