import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildDeterministicBulkKeywordRecoverySeeds } from "../src/lib/keywordEngineElonBulkKeywordRecovery.ts";
import { composeFreshKeywordElonMallTitles } from "../src/lib/keywordEngineElonFreshMallTitleComposerV11.ts";
import {
  buildKeywordElonTitleKeywordReservoirV8,
  selectKeywordElonComplementSearchKeywordsV8,
} from "../src/lib/keywordEngineElonKeywordPortfolioV8SparseGuardV10.ts";
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

function portfolioCovers(rows, keywords) {
  const used = new Set(
    rows.flatMap((row) => row.keywordMaterials ?? []).map((value) =>
      String(value).replace(/\s+/g, "").toLowerCase(),
    ),
  );
  return keywords.every((keyword) =>
    used.has(String(keyword).replace(/\s+/g, "").toLowerCase()),
  );
}

function aaa442RecoveryInput() {
  return {
    productName: "세탁기원형받침대 4P세트",
    customBlockedTerms: [],
    source: {
      url: "https://detail.1688.com/offer/656949712525.html",
      offerId: "656949712525",
      autoStatus: "partial",
      chineseTitle: "세탁기원형받침대 4P세트",
      optionText: "",
      supportingText: "",
      warnings: [],
      collectedAt: new Date(0).toISOString(),
    },
    identity: {
      model: "gpt-5-mini",
      reasoning: "fixture",
      confidence: 0.9,
      coreProduct: "세탁기 받침대",
      koreanProductIdentity: "세탁기용 원형 받침대 4개 세트",
      identityAnchor: "세탁기용 원형 받침대 4개 세트",
      primarySeeds: [
        "세탁기 받침대",
        "세탁기용 원형 받침대 4개 세트",
        "세탁기용 원형 받침대",
        "가전용 원형 받침대",
      ],
      conditionalSeeds: [
        "원형 받침대 4P 세트(가전용)",
        "세탁기 받침대 세트(4개)",
      ],
      functionModifiers: [],
      designShapeModifiers: ["원형"],
      specAttributes: [],
      variantNoise: ["4개 세트(4P)"],
    },
  };
}

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

test("V12 검색어는 제목과 겹치더라도 검증된 직접키워드를 합성 복구어보다 먼저 쓴다", () => {
  const rankedDirectKeywords = [
    {
      keyword: "받침대",
      key: "받침대",
      score: 95,
      relevance: 95,
      shoppingIntent: 95,
      specificity: 55,
      qualityScore: 82,
      demandScore: 90,
      competitionOpportunity: 70,
      totalSearch: 23650,
      titleEligible: true,
      intentClass: "core_synonym",
    },
    {
      keyword: "받침대4개",
      key: "받침대4개",
      score: 88,
      relevance: 90,
      shoppingIntent: 80,
      specificity: 85,
      qualityScore: 44,
      demandScore: 20,
      competitionOpportunity: 55,
      totalSearch: null,
      titleEligible: true,
      intentClass: "form",
    },
  ];
  const selection = selectKeywordElonComplementSearchKeywordsV8({
    rankedDirectKeywords,
    titleTexts: ["받침대 받침대4개 세탁기용 원형받침대"],
    supplementalSearchKeywords: [
      "세탁기원형받침대",
      "세탁기받침대",
      "세탁기용원형받침대",
      "가전용원형받침대",
      "세탁기용받침대",
      "원형받침대",
      "가전용받침대",
      "원형세탁기받침대",
    ],
    limit: 10,
  });

  assert.deepEqual(selection.searchKeywords.slice(0, 2), ["받침대", "받침대4개"]);
  assert.equal(selection.directSelectedCount, 2);
  assert.equal(selection.searchKeywords.length, 10);
});

test("V12 AAA442 복구는 기준을 낮추지 않고 자연스러운 제품명 결합만으로 8개 이상 보충 후보를 만든다", () => {
  const seeds = buildDeterministicBulkKeywordRecoverySeeds(aaa442RecoveryInput());
  const required = [
    "세탁기원형받침대",
    "세탁기받침대",
    "세탁기용원형받침대",
    "가전용원형받침대",
    "세탁기용받침대",
    "원형받침대",
    "가전용받침대",
    "원형세탁기받침대",
  ];
  for (const keyword of required) assert.ok(seeds.includes(keyword), keyword);
  assert.ok(seeds.length >= 8);
  assert.equal(
    seeds.some((keyword) => /재질|용도|형태|있는|옵션|모델번호/.test(keyword)),
    false,
  );
});

test("V12 복구는 설명문 메타 조각을 FINAL 검색어 후보로 만들지 않는다", () => {
  const input = aaa442RecoveryInput();
  input.productName = "실리콘 땅콩 골프공커버";
  input.identity = {
    ...input.identity,
    coreProduct: "골프공 커버",
    koreanProductIdentity: "실리콘 땅콩형 골프공 커버",
    identityAnchor: "실리콘 땅콩형 골프공 커버",
    primarySeeds: ["골프공 커버", "실리콘 골프공 커버", "실리콘 골프공 캡"],
    conditionalSeeds: ["땅콩 모양 실리콘 골프공 커버"],
    functionModifiers: ["표면 보호", "커버/캡"],
    designShapeModifiers: ["땅콩형"],
    specAttributes: ["재질: 실리콘", "용도: 골프공 전용"],
  };
  const seeds = buildDeterministicBulkKeywordRecoverySeeds(input);
  assert.equal(seeds.some((keyword) => keyword === "재질실리콘"), false);
  assert.equal(seeds.some((keyword) => keyword === "용도골프공전용"), false);
  assert.equal(seeds.some((keyword) => keyword === "표면보호"), false);
  assert.equal(seeds.every((keyword) => keyword.includes("커버") || keyword === "실리콘골프공캡"), true);
});

test("V11 희소 보충어는 기준 하향이 아니라 기존 STEP4+V10 안전 복구기를 통과한 뒤에만 FINAL compose에 들어간다", async () => {
  const source = await readFile(
    new URL("../src/lib/keywordEngineElonBulkFinalV11.ts", import.meta.url),
    "utf8",
  );
  const recovery = await readFile(
    new URL("../src/lib/keywordEngineElonBulkKeywordRecovery.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /generateSafeBulkKeywordSupplements/);
  assert.match(source, /verifiedKeywordPool/);
  assert.match(source, /SEO_KEYWORD_V12_SHOPLING_OUTPUT_LIMIT:10/);
  assert.match(source, /customBlockedTerms/);
  assert.match(recovery, /filterKeywordElonProhibitedKeywords/);
  assert.match(recovery, /bulk_keyword_recovery_v12/);
  assert.match(recovery, /FORBIDDEN_SYNTHETIC_FRAGMENTS/);
});

test("V11은 AAA442형 희소 키워드에서도 29개를 만들고 커버리지는 전체 포트폴리오에서 보장한다", () => {
  const finalKeywords = ["받침대", "받침대4개"];
  const result = composeFreshKeywordElonMallTitles({
    markets: PRODUCT_GROUP_MARKET_REGISTRY,
    finalKeywords,
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
  assert.equal(portfolioCovers(result.rows, finalKeywords), true);
  assert.equal(result.keywordCoverageCount, finalKeywords.length);
  assert.equal(result.keywordCoverageTotal, finalKeywords.length);
});

test("V11은 AAA481형 복수 최종키워드를 각 1행 몰에 모두 강요하지 않고 29행 전체에서 빠짐없이 쓴다", () => {
  const finalKeywords = [
    "스트라이프버킷햇",
    "벙거지버킷햇",
    "버킷햇벙거지",
  ];
  const result = composeFreshKeywordElonMallTitles({
    markets: PRODUCT_GROUP_MARKET_REGISTRY,
    finalKeywords,
    titleExpansionPool: [],
    modelName: "스트라이프 버킷햇",
    context: {
      modelNumber: "AAA481",
      productName: "스트라이프 버킷햇",
      category: "잡화>패션잡화>모자>등산모자",
    },
    blockedTerms: [],
    variationSeed: "aaa481-v11-portfolio-coverage",
  });

  assert.equal(result.rows.length, 29);
  assert.equal(sameMallTitlesAreUnique(result.rows), true);
  assert.equal(portfolioCovers(result.rows, finalKeywords), true);
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
  assert.equal(portfolioCovers(result.rows, ["커버"]), true);
});

test("production alias는 V11 guarded bulk/fresh composer를 사용한다", async () => {
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
