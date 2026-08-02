import {
  generateShoplingCategoryRecommendations,
  type ProductCategoryInput,
  type ProductCategoryRecommendation,
} from "./shoplingCategoryCatalog";
import { isOpenAiStructuredOutputIncompleteError } from "./openAiStructuredOutput";

const CATEGORY_BATCH_SIZE = 2;
const CATEGORY_BATCH_CONCURRENCY = 4;

type RecommendationResult = Awaited<
  ReturnType<typeof generateShoplingCategoryRecommendations>
>;

type RecommendationOptions = {
  apiKey?: string;
  model?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

export async function generateReliableShoplingCategoryRecommendations(
  inputs: ProductCategoryInput[],
  options: RecommendationOptions = {},
) {
  if (!inputs.length) {
    throw new Error("AI 카테고리를 설정할 상품을 선택하세요.");
  }

  const batches = chunk(inputs, CATEGORY_BATCH_SIZE);
  const batchResults = await mapWithConcurrency(
    batches,
    CATEGORY_BATCH_CONCURRENCY,
    (batch) => generateBatchWithRecovery(batch, options),
  );
  return mergeRecommendationResults(batchResults, inputs);
}

async function generateBatchWithRecovery(
  batch: ProductCategoryInput[],
  options: RecommendationOptions,
): Promise<RecommendationResult> {
  try {
    return await generateShoplingCategoryRecommendations(
      { items: batch },
      options,
    );
  } catch (error) {
    if (!isRetryableCategoryOutputError(error)) throw error;
    if (batch.length === 1) {
      try {
        return await generateShoplingCategoryRecommendations(
          { items: batch },
          options,
        );
      } catch (retryError) {
        if (!isRetryableCategoryOutputError(retryError)) throw retryError;
        throw new Error(
          `${batch[0].modelNumber || batch[0].productName}의 AI 응답이 두 번 연속 중간에서 잘렸습니다. 잠시 후 해당 상품만 다시 실행하세요.`,
          { cause: retryError },
        );
      }
    }

    const singleResults = await Promise.all(
      batch.map((input) =>
        generateBatchWithRecovery([input], options),
      ),
    );
    return mergeRecommendationResults(singleResults, batch);
  }
}

export function isRetryableCategoryOutputError(error: unknown) {
  if (isOpenAiStructuredOutputIncompleteError(error)) return true;
  if (error instanceof SyntaxError) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Unterminated string|Unexpected end of JSON|JSON.*(?:잘렸|완성되지)|응답이 비어|output.*incomplete|max_output_tokens/i.test(
    message,
  );
}

function mergeRecommendationResults(
  results: RecommendationResult[],
  expectedInputs: ProductCategoryInput[],
): RecommendationResult {
  if (!results.length) {
    throw new Error("AI 카테고리 결과가 비어 있습니다.");
  }
  const first = results[0];
  const byId = new Map<string, ProductCategoryRecommendation>();
  for (const result of results) {
    for (const recommendation of result.results) {
      byId.set(recommendation.itemId, recommendation);
    }
  }
  const ordered = expectedInputs.map((input) => byId.get(input.itemId));
  if (ordered.some((value) => !value)) {
    throw new Error("일부 상품의 AI 카테고리 결과가 누락되었습니다.");
  }
  return {
    status: "success",
    snapshot: first.snapshot,
    autoApplyConfidence: first.autoApplyConfidence,
    results: ordered as ProductCategoryRecommendation[],
  };
}

function chunk<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
) {
  const result = new Array<R>(values.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await worker(values[index]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      () => runWorker(),
    ),
  );
  return result;
}
