import assert from "node:assert/strict";
import test from "node:test";

import {
  buildKeywordElonTitleKeywordReservoirV8,
  selectKeywordElonComplementSearchKeywordsV8,
} from "../src/lib/keywordEngineElonKeywordPortfolioV8.ts";

function candidate(keyword, score, overrides = {}) {
  return {
    keyword,
    searchKey: keyword,
    searchKeyword: keyword,
    sourceTags: ["test"],
    totalSearch: 1000 - score,
    pcSearch: null,
    mobileSearch: null,
    compIdx: "LOW",
    plAvgDepth: null,
    demandScore: 72,
    competitionOpportunity: 85,
    relevance: 92,
    shoppingIntent: 88,
    specificity: 82,
    titleEligible: true,
    rationale: "test",
    qualityScore: score,
    safetyPass: true,
    safetyReason: "pass",
    dataConfidence: "high",
    ...overrides,
  };
}

const directKeywords = [
  "샤워기헤드",
  "샤워헤드",
  "욕실샤워수전",
  "욕실샤워기헤드",
  "블랙샤워수전",
  "사각해바라기",
  "절수샤워헤드",
  "수압상승샤워기",
  "욕실수전",
  "샤워수전",
  "사각샤워헤드",
  "블랙샤워헤드",
  "교체용샤워헤드",
  "욕실샤워기",
  "샤워기교체",
];

const candidates = directKeywords.map((keyword, index) =>
  candidate(keyword, 82 - index * 0.7),
);

const allowedKeys = [...directKeywords];

test("V8은 검색어 10개 제한과 별개로 우수 직접키워드를 상품명용 풀에 최대한 보존한다", () => {
  const reservoir = buildKeywordElonTitleKeywordReservoirV8({
    candidates,
    allowedKeys,
    fallbackKeywords: [
      "샤워기헤드샤워헤드",
      "샤워헤드샤워기헤드",
    ],
  });

  assert.equal(reservoir.titleKeywords.length, 12);
  assert.equal(reservoir.rankedDirectKeywords.length, 15);
  assert.ok(reservoir.excellentDirectCount >= 12);
  assert.ok(
    reservoir.titleKeywords.every((keyword) => directKeywords.includes(keyword)),
    JSON.stringify(reservoir.titleKeywords),
  );
  assert.ok(!reservoir.titleKeywords.includes("샤워기헤드샤워헤드"));
});

test("V8 검색어는 상품명에 쓰이지 않은 우수 직접키워드를 먼저 채우고 부족할 때만 겹침을 허용한다", () => {
  const reservoir = buildKeywordElonTitleKeywordReservoirV8({
    candidates,
    allowedKeys,
  });
  const titleTexts = reservoir.titleKeywords.map(
    (keyword, index) => `${keyword} 테스트보조${index + 1}`,
  );
  const result = selectKeywordElonComplementSearchKeywordsV8({
    rankedDirectKeywords: reservoir.rankedDirectKeywords,
    titleTexts,
    fallbackSearchKeywords: [
      "샤워기헤드샤워헤드",
      "샤워헤드샤워기헤드",
      "샤워헤드욕실샤워수전",
    ],
  });

  assert.equal(result.searchKeywords.length, 10);
  assert.deepEqual(
    result.searchKeywords.slice(0, 3).sort(),
    directKeywords.slice(12).sort(),
  );
  assert.equal(result.syntheticFallbackCount, 0);
  assert.equal(result.directSelectedCount, 10);
  assert.ok(result.nonOverlapCount >= 3);
  assert.ok(result.overlapFallbackCount <= 7);
});

test("직접 우수키워드가 적을 때만 합성 검색어를 10칸 보충용으로 쓰고 상품명 재료에는 넣지 않는다", () => {
  const sparseCandidates = candidates.slice(0, 6);
  const sparseAllowed = directKeywords.slice(0, 6);
  const fallback = [
    ...sparseAllowed,
    "샤워기헤드샤워헤드",
    "샤워헤드샤워기헤드",
    "샤워헤드욕실샤워수전",
    "욕실샤워수전샤워헤드",
  ];
  const reservoir = buildKeywordElonTitleKeywordReservoirV8({
    candidates: sparseCandidates,
    allowedKeys: sparseAllowed,
    fallbackKeywords: fallback,
  });
  assert.equal(reservoir.titleKeywords.length, 6);
  assert.ok(
    reservoir.titleKeywords.every((keyword) => sparseAllowed.includes(keyword)),
  );

  const result = selectKeywordElonComplementSearchKeywordsV8({
    rankedDirectKeywords: reservoir.rankedDirectKeywords,
    titleTexts: reservoir.titleKeywords.map((keyword) => `${keyword} 욕실용품`),
    fallbackSearchKeywords: fallback,
  });
  assert.equal(result.searchKeywords.length, 10);
  assert.equal(result.directSelectedCount, 6);
  assert.equal(result.syntheticFallbackCount, 4);
});
