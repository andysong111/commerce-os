import assert from "node:assert/strict";
import test from "node:test";

import {
  branchRepairCandidatePaths,
  buildShoplingBranchOptions,
  pathMatchesShoplingBranches,
  shouldRepairShoplingRecommendation,
  shoplingBranchPrefix,
} from "../src/lib/shoplingCategoryBranchRepair.ts";

function recommendation(overrides = {}) {
  return {
    itemId: "item-1",
    modelNumber: "AAA480",
    selectedPath: "가구/인테리어>DIY자재/용품>자재>방문/도어용품",
    confidence: 49,
    reason: "낮은 신뢰도 후보",
    alternatives: [],
    autoApply: false,
    skippedExisting: false,
    candidatePaths: ["가구/인테리어>DIY자재/용품>자재>방문/도어용품"],
    matchKind: "context",
    marketEvidence: {
      status: "model_fallback",
      confidence: 49,
      summary: "",
      categoryPaths: [],
      sourceDomains: [],
    },
    ...overrides,
  };
}

const categories = [
  { path: "가구/인테리어>DIY자재/용품>자재>방문/도어용품" },
  { path: "패션잡화>우산/양산/우비>우비" },
  { path: "패션잡화>우산/양산/우비>레인코트" },
  { path: "문구/취미>문구/사무용품>책갈피" },
  { path: "가구/인테리어>DIY자재/용품>가구부속품>서랍레일" },
];

test("샵플링 경로에서 실제 상위 2단계 분기를 만든다", () => {
  assert.equal(
    shoplingBranchPrefix("가구/인테리어>DIY자재/용품>가구부속품>서랍레일"),
    "가구/인테리어>DIY자재/용품",
  );
  assert.deepEqual(buildShoplingBranchOptions(categories), [
    "가구/인테리어>DIY자재/용품",
    "문구/취미>문구/사무용품",
    "패션잡화>우산/양산/우비",
  ]);
});

test("우비가 가구 분기로 잘못 선택되면 정밀 재선택 대상으로 잡는다", () => {
  const branches = ["패션잡화>우산/양산/우비"];
  assert.equal(
    pathMatchesShoplingBranches(recommendation().selectedPath, branches),
    false,
  );
  assert.equal(shouldRepairShoplingRecommendation(recommendation(), branches), true);
});

test("올바른 분기 안에서도 신뢰도가 낮으면 더 정확한 세부 카테고리를 다시 고른다", () => {
  const branches = ["패션잡화>우산/양산/우비"];
  const lowConfidence = recommendation({
    selectedPath: "패션잡화>우산/양산/우비>우비",
    confidence: 55,
  });
  const highConfidence = recommendation({
    selectedPath: "패션잡화>우산/양산/우비>우비",
    confidence: 84,
  });

  assert.equal(shouldRepairShoplingRecommendation(lowConfidence, branches), true);
  assert.equal(shouldRepairShoplingRecommendation(highConfidence, branches), false);
});

test("정밀 재선택 후보는 선택된 업종 분기 밖으로 새지 않는다", () => {
  const input = {
    itemId: "item-1",
    modelNumber: "AAA480",
    productName: "재사용 EVA 우비 140g",
    optionLabels: [],
    currentCategory: "",
    chinaProductLinks: [],
  };
  const candidates = branchRepairCandidatePaths(
    input,
    categories,
    ["패션잡화>우산/양산/우비"],
    recommendation().candidatePaths,
  );

  assert.deepEqual(candidates.sort(), [
    "패션잡화>우산/양산/우비>레인코트",
    "패션잡화>우산/양산/우비>우비",
  ]);
  assert.ok(candidates.every((path) => path.startsWith("패션잡화>우산/양산/우비>")));
});
