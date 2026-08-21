import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { PRODUCT_GROUP_MARKET_REGISTRY } from "../src/lib/productGroupMarketRegistry.ts";
import {
  buildKeywordElonSeoPackage,
  KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
  KEYWORD_ELON_SEO_GROUP_STRATEGIES,
  KEYWORD_ELON_SEO_NOISE_TERMS,
  KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT,
  keywordElonSeoCanonical,
} from "../src/lib/keywordEngineElonLabSeoOutput.ts";

function candidate(keyword, relevance, qualityScore, totalSearch, overrides = {}) {
  return {
    keyword,
    searchKey: keywordElonSeoCanonical(keyword),
    searchKeyword: keywordElonSeoCanonical(keyword),
    relevance,
    shoppingIntent: 90,
    specificity: 80,
    qualityScore,
    totalSearch,
    ...overrides,
  };
}

function identity() {
  return {
    koreanProductIdentity: "코 보정용 일회용 테이프",
    coreProduct: "코 보정 테이프",
    identityAnchor: "콧볼 콧구멍 보정용 붙이는 테이프",
    primarySeeds: ["코보정테이프", "콧볼축소테이프", "코모양보정패치"],
    conditionalSeeds: ["일회용코패치", "재단가능코테이프", "붙이는코스티커"],
    functionModifiers: ["콧볼 축소", "콧구멍 보정", "모양 유지"],
    designShapeModifiers: ["슬림 스트립형", "스티커형"],
    specAttributes: ["일회용", "재단 가능", "61x11mm", "제조지 중국 광동성", "포장 단위 10개"],
  };
}

const candidates = [
  candidate("콧볼축소", 95, 81.1, 6760, { specificity: 88 }),
  candidate("코보정테이프", 95, 80.5, 6180, { specificity: 92 }),
  candidate("코테이프", 94, 79.4, 5600, { specificity: 85 }),
  candidate("콧구멍보정", 93, 78.2, 4200, { specificity: 90 }),
  candidate("코모양보정", 92, 77.5, 3100, { specificity: 88 }),
  candidate("붙이는테이프", 91, 76.8, 2500, { specificity: 82 }),
  candidate("일회용코패치", 91, 75.9, 1900, { specificity: 86 }),
  candidate("콧대보정", 90, 74.4, 1500, { specificity: 83 }),
  candidate("코스티커", 90, 73.8, 1200, { specificity: 80 }),
  candidate("코교정패치", 90, 72.9, 900, { specificity: 85 }),
  candidate("슬림코테이프", 90, 71.8, 700, { specificity: 86 }),
  candidate("재단코테이프", 90, 70.4, 500, { specificity: 84 }),
  candidate("도매코테이프", 99, 99, 100000),
  candidate("대량납품테이프", 99, 99, 100000),
];

const allowedKeys = candidates.map((row) => row.searchKey);

function build(input = {}) {
  return buildKeywordElonSeoPackage(
    {
      identity: identity(),
      candidates,
      allowedKeys,
      blockedKeys: [],
      customBlockedTerms: [],
      titleResult: {
        title: "코 보정용 일회용 테이프 콧볼축소 붙이는 스티커",
        usedKeywords: ["콧볼축소", "코보정테이프", "붙이는테이프"],
      },
      ...input,
    },
    PRODUCT_GROUP_MARKET_REGISTRY,
  );
}

test("SEO output uses exactly ten comma-separated final-material keywords and 50-byte titles", () => {
  const output = build();

  assert.equal(output.status, "ready");
  assert.equal(output.commonSearchKeywords.length, 10);
  assert.equal(output.commonSearchLine, output.commonSearchKeywords.join(","));
  assert.equal(/\s/.test(output.commonSearchLine), false);
  assert.equal(output.externalMaterialCount, 0);
  assert.equal(output.mallTitles.length, 29);
  assert.equal(output.mallTitles.every((row) => row.byteLength <= KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT), true);
  assert.equal(KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT, 50);
  assert.ok(output.uniqueTitleCount <= 13);
  assert.ok(output.uniqueTitleCount >= 6);

  assert.deepEqual(
    Object.fromEntries(
      ["도매1", "도매2", "도매3", "도매4", "소매1", "소매2"].map((group) => [
        group,
        output.mallTitles.filter((row) => row.productGroup === group).length,
      ]),
    ),
    { 도매1: 5, 도매2: 3, 도매3: 3, 도매4: 1, 소매1: 12, 소매2: 5 },
  );

  const strategyLimits = Object.fromEntries(
    KEYWORD_ELON_SEO_GROUP_STRATEGIES.map((strategy) => [strategy.productGroup, strategy.variantLimit]),
  );
  for (const group of Object.keys(strategyLimits)) {
    const titles = new Set(output.mallTitles.filter((row) => row.productGroup === group).map((row) => row.title));
    assert.ok(titles.size <= strategyLimits[group], `${group} variants`);
  }

  for (const forbidden of [...KEYWORD_ELON_SEO_FORBIDDEN_TERMS, ...KEYWORD_ELON_SEO_NOISE_TERMS]) {
    assert.equal(output.commonSearchKeywords.some((keyword) => keyword.includes(keywordElonSeoCanonical(forbidden))), false);
    assert.equal(output.mallTitles.some((row) => row.title.includes(forbidden)), false);
  }

  const searchSet = new Set(output.commonSearchKeywords);
  for (const row of output.mallTitles) {
    assert.equal(row.title, row.usedMaterials.join(" "));
    assert.equal(row.usedMaterials.every((keyword) => searchSet.has(keyword)), true);
  }
});

test("narrow STEP 4 output reaches ten using only validated two-material combinations", () => {
  const narrowCandidates = candidates.slice(0, 4);
  const output = build({
    identity: {
      ...identity(),
      conditionalSeeds: [...identity().conditionalSeeds, "도매 전용", "대량 납품"],
    },
    candidates: narrowCandidates,
    allowedKeys: narrowCandidates.map((row) => row.searchKey),
    blockedKeys: ["코교정"],
    customBlockedTerms: ["의료기기"],
    titleResult: { usedKeywords: ["콧볼축소", "코보정테이프"] },
  });

  assert.equal(output.commonSearchKeywords.length, 10);
  assert.ok(output.generatedFallbackKeywordCount > 0);
  assert.equal(output.externalMaterialCount, 0);
  const finalMaterials = new Set(narrowCandidates.map((row) => keywordElonSeoCanonical(row.keyword)));
  for (const detail of output.searchKeywordDetails) {
    assert.ok(detail.sourceMaterials.length <= 2);
    assert.equal(detail.sourceMaterials.every((material) => finalMaterials.has(keywordElonSeoCanonical(material))), true);
  }
  assert.equal(output.commonSearchKeywords.some((keyword) => /도매|대량|납품|의료기기|코교정/.test(keyword)), false);
  assert.equal(output.mallTitles.some((row) => /도매|대량|납품|의료기기|코교정/.test(row.title)), false);
});

test("screenshot-like nine final keywords keep all clean originals and add one short pair", () => {
  const finalRows = [
    candidate("콧볼축소", 95, 81.1, 6760, { specificity: 90 }),
    candidate("붙이는", 90, 76, 2800, { specificity: 55 }),
    candidate("스티커", 91, 75, 2400, { specificity: 58 }),
    candidate("테이프", 93, 77, 5200, { specificity: 62 }),
    candidate("콧대", 90, 73, 1800, { specificity: 70 }),
    candidate("콧구멍축소", 94, 80, 3600, { specificity: 92 }),
    candidate("흰색테이프", 90, 72, 900, { specificity: 78 }),
    candidate("콧등", 90, 71, 700, { specificity: 68 }),
    candidate("콧대높이기", 93, 79, 3200, { specificity: 90 }),
    candidate("제조지중국광동성", 99, 99, 100000, { specificity: 99 }),
    candidate("포장단위10개", 99, 99, 100000, { specificity: 99 }),
  ];
  const output = build({
    candidates: finalRows,
    allowedKeys: finalRows.map((row) => row.searchKey),
  });

  assert.equal(output.commonSearchKeywords.length, 10);
  assert.equal(output.marketDerivedKeywordCount, 9);
  assert.equal(output.generatedFallbackKeywordCount, 1);
  assert.equal(output.filteredNoiseMaterialCount, 2);
  assert.equal(output.searchKeywordDetails.filter((row) => row.origin === "step4_pair").length, 1);
  assert.equal(output.searchKeywordDetails.every((row) => row.sourceMaterials.length <= 2), true);
  assert.equal(output.commonSearchKeywords.some((keyword) => keyword.length > 12), false);
  assert.equal(output.commonSearchKeywords.some((keyword) => /제조|중국|광동|포장|코보정용일회용/.test(keyword)), false);
  assert.equal(output.mallTitles.some((row) => /제조|중국|광동|포장/.test(row.title)), false);
  assert.equal(output.mallTitles.every((row) => row.byteLength <= 50), true);
  const broadOnly = new Set(["붙이는", "스티커", "테이프", "콧대", "콧등"]);
  assert.equal(output.mallTitles.some((row) => broadOnly.has(row.title.split(" ")[0])), false);
});

test("wholesale titles prioritize exactness while retail1 prioritizes measured demand", () => {
  const ranked = [
    candidate("정확형테이프", 100, 82, 50, { specificity: 100, shoppingIntent: 90 }),
    candidate("수요형테이프", 90, 82, 100000, { specificity: 75, shoppingIntent: 90 }),
    candidate("기능형테이프", 96, 80, 1000, { specificity: 95, shoppingIntent: 92 }),
    candidate("세부형테이프", 95, 79, 700, { specificity: 96, shoppingIntent: 88 }),
    candidate("사용형테이프", 92, 78, 6000, { specificity: 86, shoppingIntent: 90 }),
    candidate("형태형스티커", 91, 77, 5000, { specificity: 84, shoppingIntent: 90 }),
    candidate("정확패치", 95, 76, 400, { specificity: 94, shoppingIntent: 88 }),
    candidate("수요스티커", 90, 75, 50000, { specificity: 72, shoppingIntent: 90 }),
    candidate("기능패치", 94, 74, 300, { specificity: 93, shoppingIntent: 90 }),
    candidate("세부패치", 93, 73, 200, { specificity: 92, shoppingIntent: 88 }),
  ];
  const output = build({
    identity: { ...identity(), coreProduct: "테이프" },
    candidates: ranked,
    allowedKeys: ranked.map((row) => row.searchKey),
  });
  const wholesale1 = output.mallTitles.find((row) => row.productGroup === "도매1");
  const retail1 = output.mallTitles.find((row) => row.productGroup === "소매1");
  const wholesaleLead = wholesale1?.title.split(" ")[0] ?? "";
  assert.ok(["정확형테이프", "기능형테이프", "세부형테이프"].includes(wholesaleLead), wholesale1?.title);
  assert.notEqual(wholesaleLead, "수요형테이프");
  assert.ok(retail1?.title.startsWith("수요형테이프"), retail1?.title);
});

test("keyword lab SEO output remains preview-only and explains group strategy", () => {
  const component = readFileSync(
    "src/app/keyword-engine-elon-lab/KeywordElonShoplingSeoOutput.tsx",
    "utf8",
  );
  assert.match(component, /SEO OUTPUT · PREVIEW ONLY/);
  assert.match(component, /최대 50bytes/);
  assert.match(component, /띄어쓰기 없이 콤마/);
  assert.match(component, /2개 재료 조합/);
  assert.match(component, /상품그룹별 고품질 변형/);
  assert.match(component, /아무것도 쓰지 않습니다/);
  assert.doesNotMatch(component, /fetch\s*\(/);
  assert.doesNotMatch(component, /dispatchKeyword|keyword-shopling-direct-apply|shopling-upload/);
});
