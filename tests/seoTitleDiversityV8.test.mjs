import assert from "node:assert/strict";
import test from "node:test";

import {
  keywordElonMallTitleSemanticSimilarity,
  rebalanceKeywordElonMallTitleDiversityV8,
} from "../src/lib/keywordEngineElonMallTitleDiversityV8.ts";

const finals = ["쿨링타올", "스포츠타올", "핸드타올"];

function row(index, title, keywordMaterials) {
  return {
    productGroup: index < 3 ? "도매1" : "소매1",
    groupSuffix: index < 3 ? "a" : "e",
    marketName: `테스트몰${index + 1}`,
    mallKey: `TEST_${index + 1}`,
    accountIdLabel: `account-${index + 1}`,
    title,
    byteLength: Buffer.byteLength(title, "utf8"),
    modelName: "쿨수건",
    modelPosition: index % 2 === 0 ? "first" : "after_lead",
    usedMaterials: keywordMaterials,
    keywordMaterials,
    titleKeywordSegments: keywordMaterials,
    strategyLabel: "intent-portfolio-v7",
    variantIndex: index,
  };
}

const selectedRows = [
  row(0, "쿨링타올 스포츠타올 쿨수건", ["쿨링타올", "스포츠타올", "쿨수건"]),
  row(1, "스포츠타올 쿨링타월 운동수건", ["스포츠타올", "쿨링타월", "운동수건"]),
  row(2, "핸드타올 스포츠타월 쿨타월", ["핸드타올", "스포츠타월", "쿨타월"]),
  row(3, "쿨링타올 스포츠수건 냉수건", ["쿨링타올", "스포츠수건", "냉수건"]),
  row(4, "스포츠타올 쿨타올 아이스타올", ["스포츠타올", "쿨타올", "아이스타올"]),
  row(5, "핸드타올 쿨링타올 스포츠타월", ["핸드타올", "쿨링타올", "스포츠타월"]),
];

const alternativeMaterials = [
  ["쿨링타올", "아이스스카프", "등산용수건"],
  ["스포츠타올", "헬스장수건", "땀흡수타월"],
  ["핸드타올", "휴대용수건", "사각파우치"],
  ["쿨링타올", "냉목도리", "야외활동수건"],
  ["스포츠타올", "아이스목수건", "러닝수건"],
  ["핸드타올", "냉감타월", "목수건"],
];

function attempt(offset) {
  const rows = selectedRows.map((base, index) => {
    if (offset === 0) return base;
    const materials = alternativeMaterials[(index + offset - 1) % alternativeMaterials.length];
    const required = finals[index % finals.length];
    const requiredMaterials = [
      required,
      ...materials.filter((material) => material !== required),
    ];
    return row(index, requiredMaterials.join(" "), requiredMaterials);
  });
  return {
    rows,
    facts: [],
    keywordCoverageCount: finals.length,
    keywordCoverageTotal: finals.length,
    uniqueTitleCount: rows.length,
    nearDuplicateCount: 0,
    warnings: ["SEO_MALL_TITLE_SOURCE:INTENT_PORTFOLIO_V7"],
  };
}

function averagePreviousSimilarity(rows) {
  let total = 0;
  let count = 0;
  for (let index = 1; index < rows.length; index += 1) {
    let maximum = 0;
    for (let previous = 0; previous < index; previous += 1) {
      maximum = Math.max(
        maximum,
        keywordElonMallTitleSemanticSimilarity(
          rows[index].title,
          rows[previous].title,
        ),
      );
    }
    total += maximum;
    count += 1;
  }
  return count ? total / count : 0;
}

test("V8 유사도는 철자 변형과 합성어가 섞인 타월 상품명을 유사 조합으로 감지한다", () => {
  const similarity = keywordElonMallTitleSemanticSimilarity(
    "쿨링타올 스포츠타올 쿨수건",
    "스포츠타올 쿨링타월 운동수건",
  );
  assert.ok(similarity >= 0.58, `similarity=${similarity}`);
});

test("V8은 검증된 재료 안에서 쇼핑몰별 제목 조합을 더 넓게 분산한다", () => {
  const attempts = [0, 1, 2, 3, 4, 5].map(attempt);
  const selected = attempt(0);
  const result = rebalanceKeywordElonMallTitleDiversityV8({
    attempts,
    selected,
    finalKeywords: finals,
  });

  assert.equal(result.rows.length, selected.rows.length);
  assert.equal(new Set(result.rows.map((entry) => entry.title)).size, result.rows.length);
  assert.ok(
    result.rows.every((entry, index) =>
      entry.keywordMaterials.includes(finals[index % finals.length]),
    ),
  );
  assert.ok(
    averagePreviousSimilarity(result.rows) <=
      averagePreviousSimilarity(selected.rows) + 0.0001,
  );
  assert.ok(
    result.warnings.some((warning) =>
      warning.startsWith("SEO_MALL_TITLE_DIVERSITY_V8:"),
    ),
  );
});
