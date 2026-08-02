import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  OpenAiStructuredOutputIncompleteError,
  parseOpenAiStructuredOutput,
  recommendationOutputTokenBudget,
} from "../src/lib/openAiStructuredOutput.ts";
import { isRetryableCategoryOutputError } from "../src/lib/shoplingCategoryRecommendationRunner.ts";

test("불완전하거나 잘린 OpenAI JSON을 재시도 가능한 오류로 변환한다", () => {
  assert.throws(
    () =>
      parseOpenAiStructuredOutput({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output_text: '{"results":[{"itemId":"a","selectedPath":"생활/건강',
      }),
    OpenAiStructuredOutputIncompleteError,
  );
  assert.throws(
    () =>
      parseOpenAiStructuredOutput({
        status: "completed",
        output_text: '{"results":[{"itemId":"a","reason":"중간',
      }),
    /중간에서 잘렸거나 완성되지 않았습니다/,
  );
  assert.equal(
    isRetryableCategoryOutputError(
      new SyntaxError("Unterminated string in JSON at position 505"),
    ),
    true,
  );
});

test("완성된 구조화 JSON은 원문을 훼손하지 않고 파싱한다", () => {
  assert.deepEqual(
    parseOpenAiStructuredOutput({
      status: "completed",
      output_text:
        '{"results":[{"itemId":"a","selectedPath":"생활/건강>수예>골무","reason":"모델명 골무 기준"}]}',
    }),
    {
      results: [
        {
          itemId: "a",
          selectedPath: "생활/건강>수예>골무",
          reason: "모델명 골무 기준",
        },
      ],
    },
  );
});

test("상품 수에 따라 출력 예산을 확장하고 재시도 때 더 늘린다", () => {
  const first = recommendationOutputTokenBudget(4, 0);
  const retry = recommendationOutputTokenBudget(4, 1);
  assert.ok(first > 2600);
  assert.ok(retry > first);
});

test("AI 카테고리 API는 2건 배치와 실패 묶음 단건 복구를 사용한다", async () => {
  const runner = await readFile(
    new URL(
      "../src/lib/shoplingCategoryRecommendationRunner.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const route = await readFile(
    new URL(
      "../src/app/api/product-launch-tracker/ai-category/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(runner, /CATEGORY_BATCH_SIZE = 2/);
  assert.match(runner, /CATEGORY_BATCH_CONCURRENCY = 4/);
  assert.match(runner, /batch\.map\(\(input\) =>/);
  assert.match(runner, /generateBatchWithRecovery\(\[input\]/);
  assert.match(runner, /두 번 연속 중간에서 잘렸습니다/);
  assert.match(route, /generateReliableShoplingCategoryRecommendations/);
  assert.doesNotMatch(route, /Unterminated string in JSON at position/);
  assert.match(route, /실패한 상품만 자동 재시도/);
});
