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

test("AAA491처럼 키워드 폭이 좁아도 검증 재료를 조합해 29개 상품명을 실제로 분산한다", () => {
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

test("SEO 쇼핑몰 상품명 다양화는 검증된 키워드·상품 정체성 재료만 사용한다", async () => {
  const diversity = await source("src/lib/keywordEngineElonMallTitleDiversity.ts");
  const bulk = await source("src/lib/keywordEngineElonBulkFinal.ts");

  assert.match(diversity, /groundedMaterials/);
  assert.match(diversity, /searchKeywords\.flatMap/);
  assert.match(diversity, /functionModifiers/);
  assert.match(diversity, /designShapeModifiers/);
  assert.match(diversity, /specAttributes/);
  assert.match(diversity, /isNearDuplicate/);
  assert.match(diversity, /similarity\(remainder, other\) >= 0\.82/);
  assert.match(diversity, /KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT/);
  assert.match(diversity, /modelOccurrenceCount\(cleaned, modelName\) === 1/);
  assert.doesNotMatch(diversity, /인기|베스트|최고|추천상품|프리미엄/);

  assert.match(bulk, /diversifyKeywordElonMallTitles/);
  assert.match(bulk, /const mallTitles = diversity\.rows/);
  assert.match(bulk, /\.\.\.diversity\.warnings/);
});

test("이미 FINAL인 미등록 상품도 클라우드를 다시 열면 중복 상품명을 자동 보정한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const bridge = await source(
    "src/app/seo-bulk-cloud/SeoBulkExistingFinalDiversityBridge.tsx",
  );

  assert.match(page, /SeoBulkExistingFinalDiversityBridge/);
  assert.match(bridge, /needsDiversityRepair/);
  assert.match(bridge, /diversifyKeywordElonMallTitles/);
  assert.match(bridge, /operation: "patch_item"/);
  assert.match(bridge, /hasRegisteredGoodsKeys\(item\)/);
  assert.match(bridge, /if \(!text\(item\.id\) \|\| hasRegisteredGoodsKeys\(item\)\) return false/);
  assert.match(bridge, /window\.location\.reload\(\)/);
  assert.match(bridge, /SEO 쇼핑몰 상품명 중복 자동보정/);
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
