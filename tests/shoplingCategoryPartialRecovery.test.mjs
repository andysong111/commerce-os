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

  assert.deepEqual(profileBatchSizes, [1, 1, 1, 1, 1, 1, 1]);
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

test("단일 상품의 웹 검색 의미분석이 일시 시간초과되면 서버 안에서 한 번 복구한다", async () => {
  const input = product(410);
  input.modelNumber = "AAA410";
  input.productName = "곰돌이 털모자 A형";
  let profileAttempts = 0;
  const profileModes = [];
  const result = await generateReliableShoplingCategoryRecommendations([input], {
    dependencies: {
      generateSearchProfiles: async (batch, options) => {
        profileAttempts += 1;
        profileModes.push(options?.useWebSearch);
        if (profileAttempts === 1) {
          throw new DOMException("This operation was aborted", "AbortError");
        }
        return batch.map((item) => ({
          itemId: item.itemId,
          coreProductTerms: ["털모자", "방한모자"],
          contextTerms: ["겨울", "방한"],
          catalogCategoryTerms: ["방한모자", "모자"],
          blockedCategoryTerms: ["완구", "인형", "반려동물"],
          ignoredAttributes: ["곰돌이", "A형"],
        }));
      },
      generateRecommendations: async (value) =>
        recommendationResult(value.items[0]),
    },
  });

  assert.equal(profileAttempts, 2);
  assert.deepEqual(profileModes, [undefined, false]);
  assert.equal(result.status, "success");
  assert.equal(result.results.length, 1);
  assert.deepEqual(result.failures, []);
});

test("11건 실행은 OpenAI 동시 호출을 3개 이하로 제한하고 전부 보존한다", async () => {
  const inputs = Array.from({ length: 11 }, (_, index) => product(index + 1));
  let activeProfiles = 0;
  let activeRecommendations = 0;
  let maxProfiles = 0;
  let maxRecommendations = 0;

  const result = await generateReliableShoplingCategoryRecommendations(inputs, {
    dependencies: {
      generateSearchProfiles: async (batch) => {
        activeProfiles += 1;
        maxProfiles = Math.max(maxProfiles, activeProfiles);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeProfiles -= 1;
        return batch.map((input) => ({
          itemId: input.itemId,
          coreProductTerms: [input.productName],
          contextTerms: [],
          ignoredAttributes: [],
        }));
      },
      generateRecommendations: async (value) => {
        activeRecommendations += 1;
        maxRecommendations = Math.max(
          maxRecommendations,
          activeRecommendations,
        );
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeRecommendations -= 1;
        return recommendationResult(value.items[0]);
      },
    },
  });

  assert.equal(result.status, "success");
  assert.equal(result.results.length, 11);
  assert.deepEqual(result.failures, []);
  assert.ok(maxProfiles <= 3);
  assert.ok(maxRecommendations <= 3);
});

test("429가 반복되면 시간초과로 뭉개지 않고 요청과다 원인을 반환한다", async () => {
  const input = product(412);
  const rateLimitError = Object.assign(
    new Error("OpenAI 모델명 분석 요청이 실패했습니다. (HTTP 429 · code=rate_limit_exceeded)"),
    { status: 429, code: "rate_limit_exceeded", retryAfterMs: 2_000 },
  );
  const result = await generateReliableShoplingCategoryRecommendations([input], {
    dependencies: {
      generateSearchProfiles: async () => {
        throw rateLimitError;
      },
      generateRecommendations: async (value) =>
        recommendationResult(value.items[0]),
    },
  });

  assert.equal(result.status, "partial");
  assert.equal(result.results.length, 0);
  assert.equal(result.failures[0].code, "AI_RATE_LIMIT");
  assert.equal(result.failures[0].retryAfterMs, 2_000);
  assert.match(result.failures[0].message, /요청이 한꺼번에 몰려/);
});
