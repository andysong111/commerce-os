import assert from "node:assert/strict";
import test from "node:test";
import { generateReliableShoplingCategoryRecommendations } from "../src/lib/shoplingCategoryRecommendationRunner.ts";

function product(index) {
  return {
    itemId: `item-${index}`,
    modelNumber: `AAA${String(index).padStart(3, "0")}`,
    productName: index === 4 ? "걸이형 모공브러쉬" : `테스트 상품 ${index}`,
    optionLabels: [],
    currentCategory: "",
    chinaProductLinks: [],
  };
}

function recommendation(input) {
  return {
    itemId: input.itemId,
    modelNumber: input.modelNumber,
    selectedPath: "생활/건강>생활용품>기타",
    confidence: 80,
    reason: "테스트 추천",
    alternatives: [],
    autoApply: false,
    skippedExisting: false,
    candidatePaths: ["생활/건강>생활용품>기타"],
    matchKind: "core",
  };
}

function recommendationResult(input) {
  return {
    status: "success",
    snapshot: {
      collectedAt: "2026-08-04T00:00:00.000Z",
      categoryCount: 9561,
      hash: "snapshot-test",
    },
    autoApplyConfidence: 90,
    results: [recommendation(input)],
  };
}

test("7건 중 한 상품이 시간 초과돼도 나머지 6건 결과를 반환한다", async () => {
  const inputs = Array.from({ length: 7 }, (_, index) => product(index + 1));
  const profileBatchSizes = [];
  const result = await generateReliableShoplingCategoryRecommendations(inputs, {
    dependencies: {
      generateSearchProfiles: async (batch) => {
        profileBatchSizes.push(batch.length);
        return batch.map((input) => ({
          itemId: input.itemId,
          coreProductTerms: [input.productName],
          contextTerms: [],
          ignoredAttributes: [],
        }));
      },
      generateRecommendations: async (value) => {
        const input = value.items[0];
        if (input.itemId === "item-4") {
          throw new DOMException("This operation was aborted", "AbortError");
        }
        return recommendationResult(input);
      },
    },
  });

  assert.deepEqual(profileBatchSizes, [4, 3]);
  assert.equal(result.status, "partial");
  assert.equal(result.results.length, 6);
  assert.deepEqual(result.failures.map((failure) => failure.itemId), ["item-4"]);
  assert.equal(result.failures[0].retryable, true);
});

test("실패 상품 재시도는 의미 분석도 상품별로 격리한다", async () => {
  const inputs = [product(4), product(5)];
  const profileBatchSizes = [];
  const result = await generateReliableShoplingCategoryRecommendations(inputs, {
    retryFailedIndividually: true,
    dependencies: {
      generateSearchProfiles: async (batch) => {
        profileBatchSizes.push(batch.length);
        return batch.map((input) => ({
          itemId: input.itemId,
          coreProductTerms: [input.productName],
          contextTerms: [],
          ignoredAttributes: [],
        }));
      },
      generateRecommendations: async (value) =>
        recommendationResult(value.items[0]),
    },
  });

  assert.deepEqual(profileBatchSizes, [1, 1]);
  assert.equal(result.status, "success");
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.failures, []);
});
