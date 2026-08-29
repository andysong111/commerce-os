import assert from "node:assert/strict";
import test from "node:test";

import { composeKeywordElonIntentPortfolioV7 } from "../src/lib/keywordEngineElonMallTitleIntentPortfolioV7.ts";

const finals = [
  "스포츠타올",
  "쿨링타월",
  "쿨타올",
  "쿨링타올",
  "쿨타월",
  "쿨수건",
  "냉감타월",
  "운동수건",
  "스포츠타월",
  "아이스타올",
];

const intentMaterials = [
  ["여름목수건", "use"],
  ["쿨링기능", "function"],
  ["스포츠수건", "category_tail"],
  ["야외활동수건", "context"],
  ["휴대형쿨타올", "form"],
];

function expansion(keyword, intentClass, score = 82) {
  return {
    keyword,
    intentClass,
    categoryAligned: true,
    categoryMatch: 95,
    relevance: 93,
    shoppingIntent: 90,
    specificity: 85,
    qualityScore: 78,
    competitionOpportunity: 60,
    totalSearch: 500,
    expansionScore: score,
  };
}

const expansionPool = [
  ...intentMaterials.map(([keyword, intent]) => expansion(keyword, intent)),
  ...Array.from({ length: 29 }, (_, index) =>
    expansion(`휴대활동${String(index + 1).padStart(2, "0")}`, "form", 76),
  ),
];

function buildAttempt(attemptIndex) {
  const rows = Array.from({ length: 29 }, (_, rowIndex) => {
    const required = finals[rowIndex % finals.length];
    const anchor = finals[(rowIndex + attemptIndex + 1) % finals.length];
    const [intentKeyword] = intentMaterials[attemptIndex % intentMaterials.length];
    const uniqueMaterial = `휴대활동${String(rowIndex + 1).padStart(2, "0")}`;
    const segments = [required, intentKeyword, anchor, uniqueMaterial];
    const title = segments.join(" ");
    return {
      productGroup: rowIndex < 12 ? "도매1" : "소매1",
      groupSuffix: rowIndex < 12 ? "a" : "e",
      marketName: `테스트몰${rowIndex + 1}`,
      mallKey: `TEST_${String(rowIndex + 1).padStart(3, "0")}`,
      accountIdLabel: `account-${rowIndex + 1}`,
      title,
      byteLength: Buffer.byteLength(title, "utf8"),
      modelName: "쿨수건",
      modelPosition: rowIndex % 2 === 0 ? "first" : "after_lead",
      usedMaterials: segments,
      keywordMaterials: segments,
      titleKeywordSegments: segments,
      strategyLabel: "long-title-priority-v6",
      variantIndex: rowIndex,
    };
  });
  return {
    rows,
    facts: [],
    keywordCoverageCount: finals.length,
    keywordCoverageTotal: finals.length,
    uniqueTitleCount: rows.length,
    nearDuplicateCount: 0,
    warnings: ["SEO_MALL_TITLE_SOURCE:LONG_TITLE_PRIORITY_V6"],
  };
}

const attempts = Array.from({ length: 15 }, (_, index) => buildAttempt(index));

test("V7은 FINAL10을 모두 충분히 쓰면서 29개 상품명을 검색의도별 포트폴리오로 분산한다", () => {
  const result = composeKeywordElonIntentPortfolioV7({
    attempts,
    finalKeywords: finals,
    expansionPool,
  });

  assert.equal(result.rows.length, 29);
  assert.equal(new Set(result.rows.map((row) => row.title)).size, 29);
  assert.equal(result.keywordCoverageCount, 10);
  assert.equal(result.keywordCoverageTotal, 10);
  assert.ok(result.rows.every((row) => row.strategyLabel === "intent-portfolio-v7"));

  const usage = new Map(finals.map((keyword) => [keyword, 0]));
  for (const row of result.rows) {
    for (const keyword of finals) {
      if (row.keywordMaterials.includes(keyword)) {
        usage.set(keyword, (usage.get(keyword) ?? 0) + 1);
      }
    }
  }
  assert.ok(
    [...usage.values()].every((count) => count >= 2),
    JSON.stringify(Object.fromEntries(usage)),
  );

  const nonCoreRows = result.rows.filter((row) =>
    row.keywordMaterials.some((material) =>
      intentMaterials.some(([keyword]) => keyword === material),
    ),
  ).length;
  assert.ok(nonCoreRows >= 20, `nonCoreRows=${nonCoreRows}`);

  const averageBytes =
    result.rows.reduce((sum, row) => sum + Buffer.byteLength(row.title, "utf8"), 0) /
    result.rows.length;
  assert.ok(averageBytes >= 40, `averageBytes=${averageBytes}`);
  assert.ok(result.warnings.includes("SEO_MALL_TITLE_SOURCE:INTENT_PORTFOLIO_V7"));
  assert.ok(
    result.warnings.some((warning) => warning.startsWith("SEO_MALL_TITLE_V7_FINAL_MIN_USAGE:")),
  );
});

test("V7은 과거 회차와 완전히 같은 제목보다 새로운 조합을 우선한다", () => {
  const excluded = attempts[0].rows.slice(0, 5).map((row) => row.title);
  const result = composeKeywordElonIntentPortfolioV7({
    attempts,
    finalKeywords: finals,
    expansionPool,
    excludedTitles: excluded,
  });
  const selected = new Set(result.rows.map((row) => row.title));
  assert.ok(excluded.every((title) => !selected.has(title)));
});
