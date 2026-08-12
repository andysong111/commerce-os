import {
  fetchShoplingCategorySnapshot,
  type ProductCategoryRecommendation,
  type ShoplingCategoryEntry,
} from "./shoplingCategoryCatalog.ts";
import { scoreNaverToShoplingCategory } from "./shoplingCategoryNaverFirst.ts";
import { parseOpenAiStructuredOutput } from "./openAiStructuredOutput.ts";
import type { ProductCategoryInput } from "./shoplingCategoryScoring.ts";

const SEARCH_CONCURRENCY = 4;
const SEARCH_TIMEOUT_MS = 22_000;
const MIN_SIMILARITY = 42;
const TOP_RESULT_LIMIT = 5;
const TOP_RESULT_WEIGHTS = [1, 0.9, 0.8, 0.7, 0.6] as const;

type OpenAiResponse = {
  status?: unknown;
  incomplete_details?: { reason?: unknown };
  output_text?: unknown;
  output?: Array<{
    type?: unknown;
    action?: { sources?: Array<{ url?: unknown }> };
    content?: Array<{ type?: unknown; text?: unknown }>;
  }>;
  error?: { message?: unknown; code?: unknown; type?: unknown };
};

type NaverEvidence = {
  categoryPaths: string[];
  confidence: number;
  summary: string;
  sourceDomains: string[];
};

type CategoryMatch = {
  path: string;
  score: number;
  sourcePath: string;
  supportCount: number;
};

type SearchOptions = {
  apiKey?: string;
  model?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function matchNaverTopFiveCategoryPathsToShopling(
  naverPaths: string[],
  categories: Pick<ShoplingCategoryEntry, "path">[],
  limit = 3,
): CategoryMatch[] {
  const sources = naverPaths.map(text).filter(Boolean).slice(0, TOP_RESULT_LIMIT);
  if (!sources.length) return [];

  return categories
    .map((category) => {
      const similarities = sources.map((source, index) => ({
        source,
        score: scoreNaverToShoplingCategory(source, category.path),
        weight: TOP_RESULT_WEIGHTS[index] ?? 0.5,
      }));
      const best = similarities.reduce(
        (current, candidate) => candidate.score > current.score ? candidate : current,
        similarities[0],
      );
      const totalWeight = similarities.reduce((sum, candidate) => sum + candidate.weight, 0);
      const weightedAverage = totalWeight
        ? similarities.reduce(
            (sum, candidate) => sum + candidate.score * candidate.weight,
            0,
          ) / totalWeight
        : 0;
      const supportCount = similarities.filter(
        (candidate) => candidate.score >= MIN_SIMILARITY,
      ).length;
      const consensusBonus = (supportCount / similarities.length) * 5;
      const score = Number(
        Math.min(
          100,
          best.score * 0.6 + weightedAverage * 0.35 + consensusBonus,
        ).toFixed(2),
      );
      return {
        path: category.path,
        score,
        sourcePath: best.source,
        supportCount,
      };
    })
    .filter(
      (candidate) =>
        candidate.score >= MIN_SIMILARITY && candidate.supportCount > 0,
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.supportCount - left.supportCount ||
        left.path.localeCompare(right.path, "ko-KR"),
    )
    .slice(0, Math.max(1, Math.min(3, limit)));
}

export async function generateNaverTopFiveShoplingCategoryRecommendations(
  inputs: ProductCategoryInput[],
  options: SearchOptions = {},
) {
  const snapshot = await fetchShoplingCategorySnapshot();
  if (!snapshot) {
    throw new Error(
      "샵플링 카테고리 스냅샷이 없습니다. 먼저 카테고리 업데이트를 실행하세요.",
    );
  }

  const apiKey = text(options.apiKey ?? process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY가 설정되지 않아 네이버 쇼핑 카테고리를 검색할 수 없습니다.");
  }
  const model = text(
    options.model ??
      process.env.OPENAI_CATEGORY_MODEL ??
      process.env.OPENAI_MODEL ??
      "gpt-4.1-mini",
  );
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = Math.min(options.timeoutMs ?? SEARCH_TIMEOUT_MS, SEARCH_TIMEOUT_MS);

  const settled = await mapWithConcurrencySettled(inputs, SEARCH_CONCURRENCY, (input) =>
    searchNaverTopFiveCategories(input, { apiKey, model, fetcher, timeoutMs }),
  );

  const results: ProductCategoryRecommendation[] = [];
  const failures: Array<{
    itemId: string;
    modelNumber: string;
    productName: string;
    stage: "search_profile" | "recommendation";
    retryable: boolean;
    code: string;
    retryAfterMs: number;
    message: string;
  }> = [];

  settled.forEach((settledResult, index) => {
    const input = inputs[index];
    if (settledResult.status === "rejected") {
      failures.push(failureFromError(input, settledResult.reason));
      return;
    }

    const evidence = settledResult.value;
    if (!evidence.categoryPaths.length) {
      failures.push(
        failure(
          input,
          "search_profile",
          "AI_INVALID_RESPONSE",
          false,
          "네이버 쇼핑 상위 5개 결과에서 카테고리 경로를 확인하지 못했습니다.",
        ),
      );
      return;
    }

    const matches = matchNaverTopFiveCategoryPathsToShopling(
      evidence.categoryPaths,
      snapshot.categories,
      3,
    );
    const selected = matches[0];
    if (!selected) {
      failures.push(
        failure(
          input,
          "recommendation",
          "AI_INVALID_RESPONSE",
          false,
          `네이버 쇼핑 상위 결과의 카테고리 '${evidence.categoryPaths[0]}' 등과 충분히 유사한 샵플링 저장 카테고리를 찾지 못했습니다.`,
        ),
      );
      return;
    }

    const candidatePaths = matches.map((candidate) => candidate.path);
    const evidenceCount = evidence.categoryPaths.length;
    results.push({
      itemId: input.itemId,
      modelNumber: input.modelNumber,
      selectedPath: selected.path,
      confidence: Math.max(
        0,
        Math.min(
          97,
          Math.round(Math.min(selected.score, evidence.confidence || selected.score)),
        ),
      ),
      reason: `모델명을 네이버 쇼핑에 검색해 상위 결과 ${evidenceCount}개에서 확인한 카테고리 경로를 종합하고, 저장된 샵플링 카테고리와 가장 유사한 경로를 선택했습니다.`,
      alternatives: candidatePaths.slice(1, 3),
      autoApply: false,
      skippedExisting: Boolean(input.currentCategory),
      candidatePaths,
      matchKind: "market",
      marketEvidence: {
        status: "web",
        confidence: evidence.confidence,
        summary: evidence.summary,
        categoryPaths: evidence.categoryPaths,
        sourceDomains: evidence.sourceDomains,
      },
    });
  });

  return {
    status: failures.length ? ("partial" as const) : ("success" as const),
    snapshot: {
      collectedAt: snapshot.collectedAt,
      categoryCount: snapshot.categoryCount,
      hash: snapshot.hash,
    },
    autoApplyConfidence: null,
    results,
    failures,
  };
}

function evidenceSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        minItems: 1,
        maxItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["itemId", "categoryPaths", "summary"],
          properties: {
            itemId: { type: "string", minLength: 1 },
            categoryPaths: {
              type: "array",
              minItems: 0,
              maxItems: TOP_RESULT_LIMIT,
              items: { type: "string", minLength: 1, maxLength: 240 },
            },
            summary: { type: "string", minLength: 0, maxLength: 240 },
          },
        },
      },
    },
  };
}

async function searchNaverTopFiveCategories(
  input: ProductCategoryInput,
  options: { apiKey: string; model: string; fetcher: typeof fetch; timeoutMs: number },
): Promise<NaverEvidence> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        store: false,
        max_output_tokens: 1_400,
        tools: [
          {
            type: "web_search",
            search_context_size: "medium",
          },
        ],
        tool_choice: "required",
        include: ["web_search_call.action.sources"],
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: [
                "당신은 네이버 쇼핑 검색결과의 카테고리 수집 담당자다.",
                "주어진 모델명을 그대로 네이버 쇼핑에서 검색한다.",
                "동일 상품인지 별도로 판정하거나 검색 결과를 탈락시키지 않는다.",
                "검색 결과 상단에서 확인 가능한 상품 5개를 순서대로 확인한다.",
                "각 상품에 네이버 쇼핑이 실제 표시하는 카테고리 경로를 categoryPaths에 같은 순서로 기록한다.",
                "같은 카테고리가 여러 상품에서 반복되면 중복을 제거하지 말고 그대로 기록한다. 반복은 다수 근거로 사용된다.",
                "색상·수량·규격·브랜드·판매처 차이는 무시한다.",
                "상위 5개 중 카테고리를 확인할 수 없는 상품은 그 항목만 건너뛰고 확인 가능한 만큼 반환한다.",
                "웹 검색 쿼리는 site:naver.com, site:shopping.naver.com 또는 site:search.shopping.naver.com 제한어를 사용해 네이버 결과를 우선 확인한다.",
                "네이버 쇼핑 이외의 쇼핑몰 카테고리나 일반 상식으로 카테고리를 추론하지 않는다.",
                "상위 결과에서 카테고리를 하나도 확인할 수 없을 때만 categoryPaths를 빈 배열로 둔다.",
              ].join("\n"),
            }],
          },
          {
            role: "user",
            content: [{
              type: "input_text",
              text: JSON.stringify({
                task: "모델명을 네이버 쇼핑에 검색하고 상위 5개 상품의 실제 카테고리 경로 수집",
                itemId: input.itemId,
                modelName: input.productName,
              }),
            }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "naver_shopping_top_five_category_evidence",
            strict: true,
            schema: evidenceSchema(),
          },
        },
      }),
      signal: controller.signal,
    });

    const payload = (await response.json()) as OpenAiResponse;
    if (!response.ok) {
      const error = new Error(
        text(payload.error?.message) ||
          `네이버 쇼핑 검색 요청에 실패했습니다. HTTP ${response.status}`,
      ) as Error & { status?: number; retryAfterMs?: number };
      error.status = response.status;
      error.retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      throw error;
    }

    const parsed = parseOpenAiStructuredOutput(payload);
    const row = Array.isArray(parsed.results) ? parsed.results[0] : null;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("네이버 쇼핑 카테고리 검색 결과 형식이 올바르지 않습니다.");
    }
    const value = row as Record<string, unknown>;
    if (text(value.itemId) !== input.itemId) {
      throw new Error("네이버 쇼핑 카테고리 검색 결과의 상품 ID가 일치하지 않습니다.");
    }

    const sourceDomains = extractNaverSourceDomains(payload);
    if (!sourceDomains.length) {
      throw new Error("네이버 검색 근거를 확인하지 못했습니다.");
    }

    const categoryPaths = Array.isArray(value.categoryPaths)
      ? value.categoryPaths.map(text).filter(Boolean).slice(0, TOP_RESULT_LIMIT)
      : [];
    const coverageConfidence = categoryPaths.length
      ? Math.min(95, 55 + categoryPaths.length * 8)
      : 0;

    return {
      categoryPaths,
      confidence: coverageConfidence,
      summary: text(value.summary).slice(0, 240),
      sourceDomains,
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractNaverSourceDomains(payload: OpenAiResponse) {
  const domains = new Set<string>();
  for (const output of payload.output ?? []) {
    if (output.type !== "web_search_call") continue;
    for (const source of output.action?.sources ?? []) {
      try {
        const hostname = new URL(text(source.url)).hostname
          .toLocaleLowerCase("en-US")
          .replace(/^www\./, "");
        if (hostname === "naver.com" || hostname.endsWith(".naver.com")) {
          domains.add(hostname);
        }
      } catch {
        // Ignore malformed source URLs.
      }
    }
  }
  return [...domains].slice(0, 8);
}

function failure(
  input: ProductCategoryInput,
  stage: "search_profile" | "recommendation",
  code: string,
  retryable: boolean,
  message: string,
  retryAfterMs = 0,
) {
  return {
    itemId: input.itemId,
    modelNumber: input.modelNumber,
    productName: input.productName,
    stage,
    retryable,
    code,
    retryAfterMs,
    message,
  };
}

function failureFromError(input: ProductCategoryInput, error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const status = error && typeof error === "object"
    ? Number((error as Record<string, unknown>).status) || 0
    : 0;
  const retryAfterMs = error && typeof error === "object"
    ? Math.max(0, Number((error as Record<string, unknown>).retryAfterMs) || 0)
    : 0;

  if (status === 429 || /rate[_ ]limit|too many requests|HTTP 429/i.test(message)) {
    return failure(
      input,
      "search_profile",
      "AI_RATE_LIMIT",
      true,
      "네이버 쇼핑 검색 요청이 한꺼번에 몰려 제한되었습니다.",
      retryAfterMs,
    );
  }
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    /aborted|timeout|timed out|시간.*초과/i.test(message)
  ) {
    return failure(
      input,
      "search_profile",
      "AI_TIMEOUT",
      true,
      "네이버 쇼핑 카테고리 검색 제한시간을 초과했습니다.",
      retryAfterMs,
    );
  }
  if (/중간에서 잘렸|완성되지|응답이 비어|max_output_tokens/i.test(message)) {
    return failure(
      input,
      "search_profile",
      "AI_OUTPUT_INCOMPLETE",
      true,
      "네이버 쇼핑 카테고리 검색 응답이 중간에서 잘렸습니다.",
      retryAfterMs,
    );
  }
  if (status >= 500 || /HTTP 5\d\d|temporar|overloaded/i.test(message)) {
    return failure(
      input,
      "search_profile",
      "AI_UPSTREAM",
      true,
      "네이버 쇼핑 검색에 사용하는 AI 서비스가 일시적으로 응답하지 않았습니다.",
      retryAfterMs,
    );
  }
  if (/fetch failed|network|ECONN|connection/i.test(message)) {
    return failure(
      input,
      "search_profile",
      "AI_NETWORK",
      true,
      "네이버 쇼핑 검색 연결이 일시적으로 끊겼습니다.",
      retryAfterMs,
    );
  }
  return failure(
    input,
    "search_profile",
    "AI_UNKNOWN",
    false,
    message.slice(0, 240) || "네이버 쇼핑 카테고리 검색을 완료하지 못했습니다.",
  );
}

function parseRetryAfterMs(value: string | null | undefined) {
  const normalized = text(value);
  if (!normalized) return 0;
  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(30_000, Math.ceil(seconds * 1_000));
  }
  const date = Date.parse(normalized);
  return Number.isFinite(date)
    ? Math.min(30_000, Math.max(0, date - Date.now()))
    : 0;
}

async function mapWithConcurrencySettled<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const result = new Array<PromiseSettledResult<R>>(values.length);
  let cursor = 0;
  async function runWorker() {
    while (cursor < values.length) {
      const index = cursor++;
      try {
        result[index] = {
          status: "fulfilled",
          value: await worker(values[index]),
        };
      } catch (reason) {
        result[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, runWorker),
  );
  return result;
}
