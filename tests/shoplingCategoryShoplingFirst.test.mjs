import assert from "node:assert/strict";
import test from "node:test";

import {
  generateShoplingFirstCategoryRecommendations,
} from "../src/lib/shoplingCategoryShoplingFirst.ts";

function input() {
  return {
    itemId: "item-1",
    modelNumber: "AAA999",
    productName: "흡착형 샤워기거치대 실버그레이",
    optionLabels: ["실버그레이"],
    currentCategory: "",
    chinaProductLinks: [],
  };
}

function recommendation(overrides = {}) {
  return {
    itemId: "item-1",
    modelNumber: "AAA999",
    selectedPath: "생활/건강 > 욕실용품 > 샤워기거치대",
    confidence: 72,
    reason: "모델명의 핵심 제품명사와 실제 샵플링 후보를 비교했습니다.",
    alternatives: ["생활/건강 > 욕실용품 > 샤워기"],
    autoApply: true,
    skippedExisting: false,
    candidatePaths: [
      "생활/건강 > 욕실용품 > 샤워기거치대",
      "생활/건강 > 욕실용품 > 샤워기",
      "생활/건강 > 욕실용품 > 욕실걸이",
    ],
    matchKind: "core",
    marketEvidence: {
      status: "model_fallback",
      confidence: 0,
      summary: "",
      categoryPaths: [],
      sourceDomains: [],
    },
    ...overrides,
  };
}

function baseResult(result = recommendation()) {
  return {
    status: "success",
    snapshot: {
      collectedAt: "2026-08-12T00:00:00.000Z",
      categoryCount: 5000,
      hash: "snapshot-hash",
    },
    autoApplyConfidence: 90,
    results: [result],
    failures: [],
  };
}

test("샵플링 우선 엔진은 웹 없이 모델명을 먼저 분석하고 실제 후보 선택 결과를 만든다", async () => {
  let capturedBaseOptions = null;
  const result = await generateShoplingFirstCategoryRecommendations([input()], {
    dependencies: {
      generateBase: async (_inputs, options) => {
        capturedBaseOptions = options;
        return baseResult();
      },
      validateNaver: async () => ({
        itemId: "item-1",
        supported: true,
        confidence: 86,
        summary: "네이버 검색에서도 샤워기 거치대로 확인됩니다.",
        categoryPaths: ["생활/건강 > 욕실용품 > 샤워기용품"],
        sourceDomains: ["search.shopping.naver.com"],
      }),
    },
  });

  assert.equal(capturedBaseOptions?.useWebSearch, false);
  assert.equal(
    result.results[0]?.selectedPath,
    "생활/건강 > 욕실용품 > 샤워기거치대",
  );
  assert.deepEqual(result.results[0]?.alternatives, [
    "생활/건강 > 욕실용품 > 샤워기",
  ]);
  assert.ok((result.results[0]?.confidence ?? 0) > 72);
  assert.equal(result.results[0]?.marketEvidence.status, "web");
  assert.equal(result.results[0]?.autoApply, false);
  assert.match(result.results[0]?.reason ?? "", /보조 검증/);
});

test("네이버 보조검증이 실패해도 샵플링 후보 결과를 폐기하지 않는다", async () => {
  const result = await generateShoplingFirstCategoryRecommendations([input()], {
    dependencies: {
      generateBase: async () => baseResult(),
      validateNaver: async () => {
        throw new Error("NAVER_TEMPORARY_FAILURE");
      },
    },
  });

  assert.equal(result.status, "success");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0]?.confidence, 72);
  assert.equal(result.results[0]?.marketEvidence.status, "model_fallback");
  assert.equal(result.results[0]?.autoApply, false);
});

test("네이버 근거가 약하거나 불일치해도 선택된 샵플링 카테고리를 바꾸지 않는다", async () => {
  const result = await generateShoplingFirstCategoryRecommendations([input()], {
    dependencies: {
      generateBase: async () => baseResult(),
      validateNaver: async () => ({
        itemId: "item-1",
        supported: false,
        confidence: 91,
        summary: "검색 결과가 혼재되어 보조근거로 사용하지 않습니다.",
        categoryPaths: [],
        sourceDomains: ["search.shopping.naver.com"],
      }),
    },
  });

  assert.equal(
    result.results[0]?.selectedPath,
    "생활/건강 > 욕실용품 > 샤워기거치대",
  );
  assert.equal(result.results[0]?.confidence, 72);
  assert.equal(result.results[0]?.marketEvidence.status, "model_fallback");
});

test("샵플링 실제 후보를 만들지 못한 상품은 네이버 검색으로 억지 카테고리를 만들지 않는다", async () => {
  let validationCalls = 0;
  const noMatch = recommendation({
    selectedPath: "",
    confidence: 0,
    alternatives: [],
    candidatePaths: [],
    matchKind: "none",
  });

  const result = await generateShoplingFirstCategoryRecommendations([input()], {
    dependencies: {
      generateBase: async () => baseResult(noMatch),
      validateNaver: async () => {
        validationCalls += 1;
        return null;
      },
    },
  });

  assert.equal(validationCalls, 0);
  assert.equal(result.results[0]?.selectedPath, "");
  assert.equal(result.results[0]?.autoApply, false);
});
