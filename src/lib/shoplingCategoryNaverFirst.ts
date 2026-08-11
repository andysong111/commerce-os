import {
  fetchShoplingCategorySnapshot,
  type ProductCategoryRecommendation,
  type ShoplingCategoryEntry,
} from "./shoplingCategoryCatalog.ts";
import { parseOpenAiStructuredOutput } from "./openAiStructuredOutput.ts";
import type { ProductCategoryInput } from "./shoplingCategoryScoring.ts";
import type {
  CategoryRecommendationFailure,
  ReliableCategoryRecommendationResult,
} from "./shoplingCategoryRecommendationRunner.ts";

const NAVER_SEARCH_CONCURRENCY = 4;
const NAVER_SEARCH_TIMEOUT_MS = 22_000;
const MIN_CATEGORY_SIMILARITY = 42;

type OpenAiResponse = {
  output_text?: unknown;
  output?: Array<{
    type?: unknown;
    action?: {
      sources?: Array<{ url?: unknown }>;
    };
  }>;
  error?: { message?: unknown; code?: unknown; type?: unknown };
};

type NaverCategoryEvidence = {
  itemId: string;
  categoryPaths: string[];
  confidence: number;
  summary: string;
  sourceDomains: string[];
};

type NaverFirstOptions = {
  apiKey?: string;
  model?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

type CategoryMatch = {
  path: string;
  score: number;
  sourcePath: string;
};

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function compact(value: unknown) {
  return text(value)
    .toLocaleLowerCase("ko-KR")
    .replaceAll("브러쉬", "브러시")
    .replaceAll("악세사리", "액세서리")
    .replaceAll("핸드폰", "휴대폰")
    .replaceAll("스마트폰", "휴대폰")
    .replaceAll("주방잡화", "주방용품")
    .replace(/[^0-9a-z가-힣]/g, "");
}

function categoryParts(value: string) {
  return value
    .split(/\s*(?:>|›|»|\/|\|)\s*/g)
    .map(text)
    .filter(Boolean);
}

function bigrams(value: string) {
  const source = compact(value);
  const result = new Set<string>();
  for (let index = 0; index < source.length - 1; index += 1) {
    result.add(source.slice(index, index + 2));
  }
  return result;
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function segmentSimilarity(left: string, right: string) {
  const a = compact(left);
  const b = compact(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.82;
  return jaccard(bigrams(a), bigrams(b));
}

export function scoreNaverToShoplingCategory(
  naverPath: string,
  shoplingPath: string,
) {
  const sourceParts = categoryParts(naverPath);
  const targetParts = categoryParts(shoplingPath);
  if (!sourceParts.length || !targetParts.length) return 0;

  const sourceLeaf = sourceParts.at(-1)!;
  const targetLeaf = targetParts.at(-1)!;
  const leafScore = segmentSimilarity(sourceLeaf, targetLeaf);

  const sourceAncestors = sourceParts.slice(0, -1);
  const targetAncestors = targetParts.slice(0, -1);
  const ancestorScore = sourceAncestors.length
    ? sourceAncestors.reduce((total, source) => {
        const best = targetAncestors.reduce(
          (maximum, target) => Math.max(maximum, segmentSimilarity(source, target)),
          0,
        );
        return total + best;
      }, 0) / sourceAncestors.length
    : 0;

  const pathScore = jaccard(bigrams(naverPath), bigrams(shoplingPath));
  const depthPenalty = Math.min(0.12, Math.abs(sourceParts.length - targetParts.length) * 0.03);
  const weighted = leafScore * 0.55 + ancestorScore * 0.3 + pathScore * 0.15 - depthPenalty;
  return Number((Math.max(0, Math.min(1, weighted)) * 100).toFixed(2));
}

export function matchNaverCategoryPathsToShopling(
  naverPaths: string[],
  categories: Pick<ShoplingCategoryEntry, "path">[],
  limit = 3,
): CategoryMatch[] {
  const sources = naverPaths.map(text).filter(Boolean);
  if (!sources.length) return [];

  return categories
    .map((category) => {
      let score = 0;
      let sourcePath = "";
      for (const source of sources) {
        const candidateScore = scoreNaverToShoplingCategory(source, category.path);
        if (candidateScore <= score) continue;
        score = candidateScore;
        sourcePath = source;
      }
      return { path: category.path, score, sourcePath };
    })
    .filter((candidate) => candidate.score >= MIN_CATEGORY_SIMILARITY)
    .sort(
      (left, right) =>
        right.score - left.score || left.path.localeCompare(right.path, "ko-KR"),
    )
    .slice(0, Math.max(1, Math.min(3, limit)));
}

export async function generateNaverFirstShoplingCategoryRecommendations(
  inputs: ProductCategoryInput[],
  options: NaverFirstOptions = {},
): Promise<ReliableCategoryRecommendationResult> {
  if (!inputs.length) {
    throw new Error("AI 카테고리를 설정할 상품을 선택하세요.");
  }

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
      "gpt-5-mini",
  );
  const fetcher = options.fetcher ?? fetch;
  const settled = await mapWithConcurrencySettled(
    inputs,
    NAVER_SEARCH_CONCURRENCY,
    (input) =>
      searchNaverShoppingCategory(input, {
        apiKey,
        model,
        fetcher,
        timeoutMs: Math.min(options.timeoutMs ?? NAVER_SEARCH_TIMEOUT_MS, NAVER_SEARCH_TIMEOUT_MS),
      }),
  );

  const results: ProductCategoryRecommendation[] = [];
  const failures: CategoryRecommendationFailure[] = [];

  settled.forEach((result, index) => {
    const input = inputs[index];
    if (result.status === "rejected") {
      failures.push(naverFailure(input, result.reason));
      return;
    }

    const evidence = result.value;
    if (!evidence.categoryPaths.length) {
      failures.push({
        itemId: input.itemId,
        modelNumber: input.modelNumber,
        productName: input.productName,
        stage: "search_profile",
        retryable: false,
        code: "AI_INVALID_RESPONSE",
        retryAfterMs: 0,
        message: "네이버 쇼핑 검색 결과에서 동일 상품의 카테고리 경로를 확인하지 못했습니다.",
      });
      return;
    }

    const matches = matchNaverCategoryPathsToShopling(
      evidence.categoryPaths,
      snapshot.categories,
      3,
    );
    const selected = matches[0];
    if (!selected) {
      failures.push({
        itemId: input.itemId,
        modelNumber: input.modelNumber,
        productName: input.productName,
        stage: "recommendation",
        retryable: false,
        code: "AI_INVALID_RESPONSE",
        retryAfterMs: 0,
        message: `네이버 쇼핑 카테고리 '${evidence.categoryPaths[0]}'와 충분히 유사한 샵플링 저장 카테고리를 찾지 못했습니다.`,
      });
      return;
    }

    const confidence = Math.max(
      0,
      Math.min(
        97,
        Math.round(Math.min(selected.score, evidence.confidence || selected.score)),
      ),
    );
    const candidatePaths = matches.map((candidate) => candidate.path);
    results.push({
      itemId: input.itemId,
      modelNumber: input.modelNumber,
      selectedPath: selected.path,
      confidence,
      reason: `네이버 쇼핑에서 확인된 '${selected.sourcePath}' 카테고리와 저장된 샵플링 카테고리 경로를 직접 비교해 가장 유사한 경로를 선택했습니다.`,
      alternatives: candidatePaths.slice(1, 3),
      autoApply: false,
      skippedExisting: Boolean(input.currentCategory),
      candidatePaths,
      matchKind: "market",
      marketEvidence: {
        status: "web",
        confidence: Math.max(0, Math.min(100, Math.round(evidence.confidence))),
        summary: evidence.summary.slice(0, 240),
        categoryPaths: evidence.categoryPaths.slice(0, 4),
        sourceDomains: evidence.sourceDomains.slice(0, 8),
      },
    });
  });

  return {
    status: failures.length ? "partial" : "success",
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

function naverEvidenceSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["itemId", "categoryPaths", "confidence", "summary"],
    properties: {
      itemId: { type: "string", minLength: 1 },
      categoryPaths: {
        type: "array",
        minItems: 0,
        maxItems: 3,
        items: { type: "string", minLength: 1, maxLength: 240 },
      },
      confidence: { type: "integer", minimum: 0, maximum: 100 },
      summary: { type: "string", minLength: 0, maxLength: 240 },
    },
  };
}

async function searchNaverShoppingCategory(
  input: ProductCategoryInput,
  options: Required<Pick<NaverFirstOptions, "apiKey" | "model" | "fetcher" | "timeoutMs">>,
): Promise<NaverCategoryEvidence> {
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
        max_output_tokens: 900,
        tools: [
          {
            type: "web_search",
            search_context_size: "low",
            filters: { allowed_domains: ["naver.com"] },
          },
        ],
        tool_choice: "required",
        include: ["web_search_call.action.sources"],
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: [
                  "당신은 네이버 쇼핑 카테고리 확인 담당자다.",
                  "주어진 모델명을 그대로 네이버에서 검색하고 쇼핑 영역/네이버 쇼핑 결과에서 동일하거나 가장 동일한 상품을 찾는다.",
                  "그 상품에 실제로 표시되거나 확인되는 카테고리 경로만 categoryPaths에 기록한다.",
                  "네이버 쇼핑 이외의 쇼핑몰 카테고리, 일반 상식에 의한 추론, 임의로 만든 카테고리는 사용하지 않는다.",
                  "색상·수량·규격 같은 옵션 차이는 무시해도 되지만 제품 종류와 용도가 다른 상품은 근거로 쓰지 않는다.",
                  "복수 결과에서 같은 카테고리가 반복되면 가장 일관된 경로를 첫 번째로 둔다.",
                  "카테고리 경로를 실제 검색 근거로 확인할 수 없으면 categoryPaths를 빈 배열로 둔다.",
                  "가능하면 대분류 > 중분류 > 소분류 > 세분류 형태를 유지한다.",
                ].join("\n"),
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  task: "네이버 쇼핑에서 모델명 검색 후 실제 카테고리 경로 확인",
                  itemId: input.itemId,
                  modelNumber: input.modelNumber,
                  modelName: input.productName,
                }),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "naver_shopping_category_evidence",
            strict: true,
            schema: naverEvidenceSchema(),
          },
        },
      }),
      signal: controller.signal,
    });

    const payload = (await response.json()) as OpenAiResponse;
    if (!response.ok) {
      const error = new Error(
        text(payload.error?.message) || `네이버 쇼핑 검색 요청에 실패했습니다. HTTP ${response.status}`,
      ) as Error & { status?: number; retryAfterMs?: number };
      error.status = response.status;
      error.retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      throw error;
    }

    const parsed = parseOpenAiStructuredOutput(payload) as Record<string, unknown>;
    const itemId = text(parsed.itemId);
    if (itemId !== input.itemId) {
      throw new Error("네이버 쇼핑 카테고리 검색 결과의 상품 ID가 일치하지 않습니다.");
    }
    const searchEvidence = extractWebSearchEvidence(payload);
    const naverSources = searchEvidence.sourceDomains.filter(
      (domain) => domain === "naver.com" || domain.endsWith(".naver.com"),
    );
    if (!searchEvidence.called || !naverSources.length) {
      throw new Error("네이버 검색 근거를 확인하지 못했습니다.");
    }

    return {
      itemId,
      categoryPaths: Array.isArray(parsed.categoryPaths)
        ? parsed.categoryPaths.map(text).filter(Boolean).slice(0, 3)
        : [],
      confidence: Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 0))),
      summary: text(parsed.summary).slice(0, 240),
      sourceDomains: naverSources,
    };
  } finally {
    clearTimeout(timer);
  }
}

function extractWebSearchEvidence(payload: OpenAiResponse) {
  let called = false;
  const domains = new Set<string>();
  for (const output of payload.output ?? []) {
    if (output.type !== "web_search_call") continue;
    called = true;
    for (const source of output.action?.sources ?? []) {
      try {
        const hostname = new URL(text(source.url)).hostname
          .toLocaleLowerCase("en-US")
          .replace(/^www\./, "");
        if (hostname) domains.add(hostname);
      } catch {
        // Ignore malformed source URLs.
      }
    }
  }
  return { called, sourceDomains: [...domains] };
}

function parseRetryAfterMs(value: string | null | undefined) {
  const normalized = text(value);
  if (!normalized) return 0;
  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(30_000, Math.ceil(seconds * 1_000));
  }
  const date = Date.parse(normalized);
  if (!Number.isFinite(date)) return 0;
  return Math.min(30_000, Math.max(0, date - Date.now()));
}

function naverFailure(
  input: ProductCategoryInput,
  error: unknown,
): CategoryRecommendationFailure {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const status =
    error && typeof error === "object"
      ? Number((error as Record<string, unknown>).status) || 0
      : 0;
  const retryAfterMs =
    error && typeof error === "object"
      ? Math.max(0, Number((error as Record<string, unknown>).retryAfterMs) || 0)
      : 0;

  if (status === 429 || /rate[_ ]limit|too many requests|HTTP 429/i.test(message)) {
    return {
      itemId: input.itemId,
      modelNumber: input.modelNumber,
      productName: input.productName,
      stage: "search_profile",
      retryable: true,
      code: "AI_RATE_LIMIT",
      retryAfterMs,
      message: "네이버 쇼핑 검색 요청이 한꺼번에 몰려 제한되었습니다.",
    };
  }
  if (
    error instanceof DOMException && error.name === "AbortError" ||
    /aborted|timeout|timed out|시간.*초과/i.test(message)
  ) {
    return {
      itemId: input.itemId,
      modelNumber: input.modelNumber,
      productName: input.productName,
      stage: "search_profile",
      retryable: true,
      code: "AI_TIMEOUT",
      retryAfterMs,
      message: "네이버 쇼핑 카테고리 검색 제한시간을 초과했습니다.",
    };
  }
  if (status >= 500 || /HTTP 5\d\d|temporar|overloaded/i.test(message)) {
    return {
      itemId: input.itemId,
      modelNumber: input.modelNumber,
      productName: input.productName,
      stage: "search_profile",
      retryable: true,
      code: "AI_UPSTREAM",
      retryAfterMs,
      message: "네이버 쇼핑 검색에 사용하는 AI 서비스가 일시적으로 응답하지 않았습니다.",
    };
  }
  if (/fetch failed|network|ECONN|connection/i.test(message)) {
    return {
      itemId: input.itemId,
      modelNumber: input.modelNumber,
      productName: input.productName,
      stage: "search_profile",
      retryable: true,
      code: "AI_NETWORK",
      retryAfterMs,
      message: "네이버 쇼핑 검색 연결이 일시적으로 끊겼습니다.",
    };
  }
  return {
    itemId: input.itemId,
    modelNumber: input.modelNumber,
    productName: input.productName,
    stage: "search_profile",
    retryable: false,
    code: "AI_UNKNOWN",
    retryAfterMs: 0,
    message: message.slice(0, 240) || "네이버 쇼핑 카테고리 검색을 완료하지 못했습니다.",
  };
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
      const index = cursor;
      cursor += 1;
      try {
        result[index] = { status: "fulfilled", value: await worker(values[index]) };
      } catch (reason) {
        result[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => runWorker()),
  );
  return result;
}
