import assert from "node:assert/strict";
import test from "node:test";

import { keywordElonMallTitleSemanticSimilarity } from "../src/lib/keywordEngineElonMallTitleDiversityV8.ts";
import { rebalanceKeywordElonSameMallTitleDiversityV9 } from "../src/lib/keywordEngineElonSameMallTitleDiversityV9.ts";

function row(index, mallKey, title, keywordMaterials) {
  return {
    productGroup: `그룹${index + 1}`,
    groupSuffix: String.fromCharCode(97 + index),
    marketName: mallKey === "SMALL_00012" ? "쿠팡" : `테스트몰${index + 1}`,
    mallKey,
    accountIdLabel: `account-${index + 1}`,
    title,
    byteLength: Buffer.byteLength(title, "utf8"),
    modelName: "발 지압 스텝퍼",
    modelPosition: "after_lead",
    usedMaterials: keywordMaterials,
    keywordMaterials,
    titleKeywordSegments: keywordMaterials,
    strategyLabel: "intent-portfolio-v8-diversity",
    variantIndex: index,
  };
}

function result(rows) {
  return {
    rows,
    facts: [],
    keywordCoverageCount: 3,
    keywordCoverageTotal: 3,
    uniqueTitleCount: new Set(rows.map((entry) => entry.title)).size,
    nearDuplicateCount: 0,
    warnings: [],
  };
}

function sameMallMaxSimilarity(rows, mallKey) {
  const sameMall = rows.filter((entry) => entry.mallKey === mallKey);
  let maximum = 0;
  for (let index = 0; index < sameMall.length; index += 1) {
    for (let previous = 0; previous < index; previous += 1) {
      maximum = Math.max(
        maximum,
        keywordElonMallTitleSemanticSimilarity(
          sameMall[index].title,
          sameMall[previous].title,
        ),
      );
    }
  }
  return maximum;
}

const finals = ["발마사지기", "발지압판", "스텝퍼"];

const selectedRows = [
  row(0, "SMALL_00012", "발마사지기 발지압판 지압발판", [
    "발마사지기",
    "발지압판",
    "지압발판",
  ]),
  row(1, "SMALL_00012", "발지압판 발마사지기 지압발판", [
    "발지압판",
    "발마사지기",
    "지압발판",
  ]),
  row(2, "SMALL_00012", "스텝퍼 발마사지기 발지압판", [
    "스텝퍼",
    "발마사지기",
    "발지압판",
  ]),
  row(3, "SMALL_00130", "발마사지기 지압발판 가정용스텝퍼", [
    "발마사지기",
    "지압발판",
    "가정용스텝퍼",
  ]),
];

const alternativeRows = [
  selectedRows[0],
  row(1, "SMALL_00012", "발지압판 지압스텝퍼 발바닥안마기", [
    "발지압판",
    "지압스텝퍼",
    "발바닥안마기",
  ]),
  row(2, "SMALL_00012", "스텝퍼 가정용운동기구 발지압매트", [
    "스텝퍼",
    "가정용운동기구",
    "발지압매트",
  ]),
  selectedRows[3],
];

test("V9은 같은 쇼핑몰의 다른 상품그룹 제목을 우선적으로 분산한다", () => {
  const selected = result(selectedRows);
  const improved = rebalanceKeywordElonSameMallTitleDiversityV9({
    attempts: [selected, result(alternativeRows)],
    selected,
    finalKeywords: finals,
  });

  assert.equal(improved.rows.length, selected.rows.length);
  assert.equal(new Set(improved.rows.map((entry) => entry.title)).size, improved.rows.length);
  assert.ok(
    sameMallMaxSimilarity(improved.rows, "SMALL_00012") <=
      sameMallMaxSimilarity(selected.rows, "SMALL_00012") + 0.0001,
  );
  assert.ok(
    improved.rows[1].keywordMaterials.includes("발지압판"),
    "required final keyword must remain in row 2",
  );
  assert.ok(
    improved.rows[2].keywordMaterials.includes("스텝퍼"),
    "required final keyword must remain in row 3",
  );
  assert.ok(
    improved.warnings.some((warning) =>
      warning.startsWith("SEO_SAME_MALL_DIVERSITY_V9:"),
    ),
  );
});

test("V9은 안전한 재료가 부족하면 같은 쇼핑몰 안에서 단어 순서를 마지막 수단으로 바꾼다", () => {
  const sparseRows = [
    row(0, "SMALL_00001", "발마사지기 발지압판 스텝퍼", [
      "발마사지기",
      "발지압판",
      "스텝퍼",
    ]),
    row(1, "SMALL_00001", "발마사지기 스텝퍼 발지압판", [
      "발지압판",
      "스텝퍼",
      "발마사지기",
    ]),
  ];
  const selected = result(sparseRows);
  const improved = rebalanceKeywordElonSameMallTitleDiversityV9({
    attempts: [selected],
    selected,
    finalKeywords: ["발마사지기", "발지압판"],
  });

  assert.notEqual(improved.rows[1].title, sparseRows[1].title);
  assert.equal(
    new Set(improved.rows[1].title.split(/\s+/)),
    new Set(sparseRows[1].title.split(/\s+/)),
  );
  assert.equal(improved.rows[1].strategyLabel, "same-mall-diversity-v9-order-fallback");
  assert.ok(
    improved.warnings.some((warning) =>
      warning === "SEO_SAME_MALL_DIVERSITY_V9_ORDER_FALLBACK:1",
    ),
  );
});
