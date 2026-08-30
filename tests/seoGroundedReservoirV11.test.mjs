import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildKeywordElonGroundedTitleSupportsV11 } from "../src/lib/keywordEngineElonBulkFinalV11.ts";
import { composeFreshKeywordElonMallTitles } from "../src/lib/keywordEngineElonFreshMallTitleComposerV11.ts";
import { buildKeywordElonTitleKeywordReservoirV8 } from "../src/lib/keywordEngineElonKeywordPortfolioV8SparseGuardV10.ts";
import { PRODUCT_GROUP_MARKET_REGISTRY } from "../src/lib/productGroupMarketRegistry.ts";

function candidate(keyword, index = 0) {
  return {
    keyword,
    searchKey: keyword,
    searchKeyword: keyword,
    sourceTags: ["v11-test"],
    totalSearch: 1000 + index * 10,
    pcSearch: null,
    mobileSearch: null,
    compIdx: "중간",
    plAvgDepth: 4,
    demandScore: 80,
    competitionOpportunity: 65,
    relevance: 95,
    shoppingIntent: 88,
    specificity: 84,
    titleEligible: true,
    rationale: "verified direct keyword",
    qualityScore: 78,
    safetyPass: true,
    safetyReason: "pass",
    dataConfidence: "high",
  };
}

function sameMallTitlesAreUnique(rows) {
  const byMall = new Map();
  for (const row of rows) {
    const set = byMall.get(row.mallKey) ?? new Set();
    const key = row.title.replace(/\s+/g, "").toLowerCase();
    if (set.has(key)) return false;
    set.add(key);
    byMall.set(row.mallKey, set);
  }
  return true;
}

const baseIdentity = {
  model: "gpt-5-mini",
  reasoning: "verified fixture",
  confidence: 0.9,
  coreProduct: "골프공 커버",
  koreanProductIdentity: "실리콘 땅콩형 골프공 커버",
  identityAnchor: "실리콘 땅콩형 골프공 커버",
  primarySeeds: ["골프공 커버", "실리콘 골프공 커버"],
  conditionalSeeds: ["땅콩 모양 골프공 커버"],
  functionModifiers: ["표면 보호"],
  designShapeModifiers: ["땅콩형"],
  specAttributes: ["재질: 실리콘", "용도: 골프공 전용"],
  variantNoise: ["AAA488"],
};

test("V11은 검증된 직접키워드가 10개를 넘으면 제목 reservoir에서 임의로 10/12개에 자르지 않는다", () => {
  const candidates = Array.from({ length: 15 }, (_, index) =>
    candidate(`검증키워드${index + 1}`, index),
  );
  const reservoir = buildKeywordElonTitleKeywordReservoirV8({
    candidates,
    allowedKeys: candidates.map((row) => row.keyword),
    limit: 12,
  });

  assert.equal(reservoir.rankedDirectKeywords.length, 15);
  assert.equal(reservoir.titleKeywords.length, 15);
  assert.deepEqual(
    new Set(reservoir.titleKeywords),
    new Set(candidates.map((row) => row.keyword)),
  );
  assert.ok(
    reservoir.warnings.some((warning) =>
      warning.startsWith("SEO_KEYWORD_V11_DIRECT_RESERVOIR_PRESERVED:"),
    ),
  );
});

test("V11 grounded support는 제품 identity/title의 사실만 분해하고 차단어는 다시 넣지 않는다", () => {
  const supports = buildKeywordElonGroundedTitleSupportsV11({
    launchItemId: "launch-aaa488",
    modelNumber: "AAA488",
    productName: "실리콘 땅콩 골프공커버",
    sourceUrl: "https://detail.1688.com/offer/1.html",
    source: {
      url: "https://detail.1688.com/offer/1.html",
      offerId: "1",
      autoStatus: "partial",
      chineseTitle: "실리콘 땅콩 골프공커버",
      optionText: "",
      supportingText: "",
      warnings: [],
      collectedAt: new Date(0).toISOString(),
    },
    collectionMode: "tracker_fallback",
    identity: {
      ...baseIdentity,
      conditionalSeeds: [...baseIdentity.conditionalSeeds, "나이키 골프공 커버"],
    },
    candidates: [candidate("커버")],
    allowedKeys: ["커버"],
    blockedKeys: [],
    finalMaterialCount: 1,
    titleResult: {
      model: "gpt-5-mini",
      title: "실리콘 땅콩형 골프공 커버",
      warning: "",
      byteLength: 36,
      usedKeywords: ["커버"],
    },
    customBlockedTerms: ["나이키"],
  });

  assert.ok(supports.some((keyword) => keyword.includes("골프공커버")));
  assert.ok(supports.some((keyword) => keyword.includes("실리콘")));
  assert.equal(supports.some((keyword) => keyword.includes("나이키")), false);
  assert.equal(supports.some((keyword) => keyword.includes("AAA488")), false);
});

test("V11은 AAA442형 희소 키워드에서도 29개를 만들고 같은 쇼핑몰 계정끼리 제목을 중복시키지 않는다", () => {
  const result = composeFreshKeywordElonMallTitles({
    markets: PRODUCT_GROUP_MARKET_REGISTRY,
    finalKeywords: ["받침대", "받침대4개"],
    titleExpansionPool: [],
    modelName: "세탁기용 원형 받침대 4개 세트",
    context: {
      modelNumber: "AAA442",
      productName: "세탁기원형받침대 4P세트",
      category: "가전/디지털>세탁기/건조기>기타 세탁기부품",
    },
    blockedTerms: [],
    variationSeed: "aaa442-v11-regression",
  });

  assert.equal(result.rows.length, 29);
  assert.equal(sameMallTitlesAreUnique(result.rows), true);
});

test("V11은 AAA488형 단일 핵심어도 검증된 modelName 조각으로 같은 쇼핑몰 4계정을 안전하게 분리한다", () => {
  const result = composeFreshKeywordElonMallTitles({
    markets: PRODUCT_GROUP_MARKET_REGISTRY,
    finalKeywords: ["커버"],
    titleExpansionPool: [],
    modelName: "실리콘 땅콩형 골프공 커버",
    context: {
      modelNumber: "AAA488",
      productName: "실리콘 땅콩 골프공커버",
      category: "도서>건강/취미>취미/레저>레저/스포츠기타",
    },
    blockedTerms: [],
    variationSeed: "aaa488-v11-regression",
  });

  assert.equal(result.rows.length, 29);
  assert.equal(sameMallTitlesAreUnique(result.rows), true);
});

test("production alias는 V11 grounded bulk/fresh composer를 사용한다", async () => {
  const tsconfig = JSON.parse(
    await readFile(new URL("../tsconfig.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(tsconfig.compilerOptions.paths["@/lib/keywordEngineElonBulkFinal"], [
    "./src/lib/keywordEngineElonBulkFinalV11.ts",
  ]);
  assert.deepEqual(
    tsconfig.compilerOptions.paths["@/lib/keywordEngineElonFreshMallTitleComposer"],
    ["./src/lib/keywordEngineElonFreshMallTitleComposerV11.ts"],
  );
});
