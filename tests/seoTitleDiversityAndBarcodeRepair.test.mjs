import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { diversifyKeywordElonMallTitles } from "../src/lib/keywordEngineElonMallTitleDiversity.ts";
import { buildOptionBarcodeIdentity } from "../src/lib/productLaunchOptionBarcodeRegistry.ts";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

const AAA491_KEYWORDS = [
  "발지압판",
  "발바닥마사지기",
  "발바닥지압",
  "지압발판",
  "발지압기",
  "발바닥지압판",
  "발바닥안마기",
  "발마사지기계",
  "발바닥맛사지기",
  "발맛사지기",
];

function keywordDetails(keywords) {
  return keywords.map((keyword, index) => ({
    keyword,
    origin: "step4",
    sourceMaterials: [keyword],
    score: 100 - index,
    relevance: 90,
    shoppingIntent: 75,
    specificity: 75,
    qualityScore: 80,
    demandScore: 70 - index,
    totalSearch: null,
  }));
}

test("레거시 다양화 함수도 AAA491처럼 키워드 폭이 좁을 때 29개 분산 계약을 유지한다", () => {
  const modelName = "발 지압 스텝퍼";
  const repeatedTitles = [
    "발 지압 스텝퍼 발지압판 지압발판",
    "발 지압 스텝퍼 발바닥마사지기",
    "발지압판 발 지압 스텝퍼 지압발판",
    "발바닥마사지기 발 지압 스텝퍼",
  ];
  const rows = Array.from({ length: 29 }, (_, index) => ({
    productGroup: index < 5 ? "도매1" : index < 8 ? "도매2" : index < 11 ? "도매3" : index === 11 ? "도매4" : index < 24 ? "소매1" : "소매2",
    title: repeatedTitles[index % repeatedTitles.length],
    modelPosition: index < 5 || index === 11 ? "first" : "after_lead",
  }));

  const result = diversifyKeywordElonMallTitles({
    rows,
    modelName,
    identity: {
      coreProduct: modelName,
      koreanProductIdentity: "발바닥 지압스텝퍼 색상랜덤",
      identityAnchor: "발바닥 지압스텝퍼",
      conditionalSeeds: ["색상랜덤 발송"],
      functionModifiers: ["색상랜덤 발송"],
    },
    searchKeywords: keywordDetails(AAA491_KEYWORDS),
  });

  assert.equal(result.rows.length, 29);
  assert.ok(result.adjustedCount >= 20, `adjusted=${result.adjustedCount}`);
  assert.equal(result.uniqueTitleCount, 29);
  assert.equal(new Set(result.rows.map((row) => row.title.replace(/\s+/g, ""))).size, 29);
  for (const row of result.rows) {
    assert.equal(row.title.split(modelName).length - 1, 1, row.title);
    assert.ok(Buffer.byteLength(row.title, "utf8") <= 50, row.title);
    assert.doesNotMatch(row.title, /인기|베스트|최고|추천상품|프리미엄/);
  }
});

test("실제 SEO bulk 경로는 FINAL10과 카테고리 Gate를 통과한 확장재료만 사용하고 30~50bytes 제목을 강제한다", async () => {
  const composer = await source("src/lib/keywordEngineElonMallTitleSafeComposer.ts");
  const bulk = await source("src/lib/keywordEngineElonBulkFinal.ts");
  const expansion = await source("src/lib/keywordEngineElonTitleExpansion.ts");
  const page = await source("src/app/seo-bulk-cloud/page.tsx");

  assert.match(composer, /modelCodeLike/);
  assert.match(composer, /MIN_TITLE_BYTES = 30/);
  assert.match(composer, /category-intent-expansion-v5/);
  assert.match(composer, /SEO_MALL_TITLE_SOURCE:CATEGORY_INTENT_EXPANSION_V5/);
  assert.match(composer, /keywordMaterials/);
  assert.match(composer, /KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT/);
  assert.doesNotMatch(composer, /factPool|htmlFacts|urlFacts|suspiciousCompositeFact|MARKETPLACE_TERMS/);
  assert.doesNotMatch(composer, /인기|베스트|최고|추천상품|프리미엄/);

  assert.match(expansion, /KEYWORD_ELON_CATEGORY_MATCH_GATE = 85/);
  assert.match(expansion, /competitionOpportunity/);
  assert.match(expansion, /intentClass/);
  assert.match(bulk, /buildKeywordElonTitleExpansionPool/);
  assert.match(bulk, /finalKeywords: searchKeywords/);
  assert.match(bulk, /titleExpansionPool/);
  assert.match(bulk, /\.\.\.mallComposition\.warnings/);
  assert.doesNotMatch(bulk, /diversifyKeywordElonMallTitles/);
  assert.doesNotMatch(page, /SeoBulkMallTitleFactBridge/);
});

test("이미 FINAL인 미등록 상품도 클라우드를 다시 열면 기존 v4 30~50B 안전 fallback으로 자동 보정한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const bridge = await source(
    "src/app/seo-bulk-cloud/SeoBulkExistingFinalDiversityBridge.tsx",
  );

  assert.match(page, /SeoBulkExistingFinalDiversityBridge/);
  assert.match(bridge, /commerceOs\.seoBulkCloud\.diversityRepair\.v4/);
  assert.match(bridge, /composeKeywordElonSafeMallTitles/);
  assert.doesNotMatch(bridge, /diversifyKeywordElonMallTitles/);
  assert.match(bridge, /operation: "patch_item"/);
  assert.match(bridge, /hasRegisteredGoodsKeys\(item\)/);
  assert.match(bridge, /if \(!text\(item\.id\) \|\| hasRegisteredGoodsKeys\(item\)\) return false/);
  assert.match(bridge, /window\.location\.reload\(\)/);
  assert.match(bridge, /composer: "final-keywords-only-v4-min-length"/);
  assert.match(bridge, /titleByteRange: \[30, 50\]/);
  assert.match(bridge, /SEO FINAL 키워드 전용 30~50B 상품명 자동보정/);
});

test("기등록 SEO 추가등록은 새 goods_key 후처리를 위해 이전 상품명·가격 request를 초기화하고 실패 시 복구한다", async () => {
  const bridge = await source(
    "src/app/seo-bulk-cloud/SeoBulkInventoryReregisterBridge.tsx",
  );

  assert.match(bridge, /previousMallSeoApply/);
  assert.match(bridge, /previousPricePolicy/);
  assert.match(bridge, /mallSeoApply: null/);
  assert.match(bridge, /pricePolicy: null/);
  assert.match(bridge, /mallSeoApply: previousMallSeoApply/);
  assert.match(bridge, /pricePolicy: previousPricePolicy/);
});

test("기존 OPTION 임시 identity가 있어도 B코드가 생기면 B코드 identity를 우선한다", () => {
  const identity = buildOptionBarcodeIdentity({
    ownerId: "owner",
    itemId: "launch-2460-aaa491",
    optionId: "aaa491-option-1",
    option: {
      barcode: " BAF6-2 ",
      optionBarcodeIdentityKey: "OPTION:owner:launch-2460-aaa491:aaa491-option-1",
    },
  });

  assert.equal(identity.identityKind, "B_CODE");
  assert.equal(identity.identityKey, "B:BAF6-2");
  assert.equal(identity.primaryBCode, "BAF6-2");
});

test("옵션바코드NO resolver는 RETURNS TABLE 변수와 충돌하지 않는 PK constraint를 사용한다", async () => {
  const migration = await source(
    "supabase/migrations/202608260001_fix_option_barcode_resolver_ambiguity.sql",
  );

  assert.match(
    migration,
    /on conflict on constraint option_barcode_registry_pkey do nothing/,
  );
  assert.doesNotMatch(migration, /on conflict \(identity_key\) do nothing/);
  assert.match(migration, /where btrim\(o\.barcode\) <> ''/);
  assert.match(migration, /optionBarcodeIdentityKind', 'B_CODE'/);
  assert.match(migration, /product_launch_tracker_states/);
});
