import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(source, /recoverableSparseComposeError/);
  assert.match(source, /customBlockedTerms/);
  assert.match(recovery, /filterKeywordElonProhibitedKeywords/);
  assert.match(recovery, /bulk_keyword_recovery/);
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
