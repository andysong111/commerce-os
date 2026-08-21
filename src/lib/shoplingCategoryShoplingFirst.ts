import {
  fetchShoplingCategorySnapshot,
  type ProductCategoryRecommendation,
} from "./shoplingCategoryCatalog.ts";
import {
  buildShoplingBranchOptions,
  classifyShoplingBranches,
  repairShoplingRecommendationWithinBranches,
  shouldRepairShoplingRecommendation,
} from "./shoplingCategoryBranchRepair.ts";
import { parseOpenAiStructuredOutput } from "./openAiStructuredOutput.ts";
import {
  generateReliableShoplingCategoryRecommendations,
  type ReliableCategoryRecommendationResult,
} from "./shoplingCategoryRecommendationRunner.ts";
import type { ProductCategoryInput } from "./shoplingCategoryScoring.ts";

const ACCURACY_REPAIR_CONCURRENCY = 3;
const NAVER_VALIDATION_CONCURRENCY = 3;
const NAVER_VALIDATION_TIMEOUT_MS = 14_000;

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

export type NaverCategoryValidation = {
  itemId: string;
  supported: boolean;
  confidence: number;
  summary: string;
  categoryPaths: string[];
  sourceDomains: string[];
};

type BaseGenerator = (
  inputs: ProductCategoryInput[],
  options: {
    apiKey?: string;
    model?: string;
    fetcher?: typeof fetch;
    timeoutMs?: number;
    useWebSearch?: boolean;
    retryFailedIndividually?: boolean;
  },
) => Promise<ReliableCategoryRecommendationResult>;

type ValidationGenerator = (
  input: ProductCategoryInput,
  recommendation: ProductCategoryRecommendation,
  options: {
    apiKey?: string;
    model?: string;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  },
) => Promise<NaverCategoryValidation | null>;

type ShoplingFirstOptions = {
  apiKey?: string;
  model?: string;
  naverModel?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  validationTimeoutMs?: number;
  retryFailedIndividually?: boolean;
  validateWithNaver?: boolean;
  accuracyRepair?: boolean;
  dependencies?: {
    generateBase?: BaseGenerator;
    validateNaver?: ValidationGenerator;
  };
};

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * 기본 엔진 순서:
 * 1) 모델명/옵션을 웹 없이 의미분석
 * 2) 실제 샵플링 카테고리 스냅샷에서 후보 축소
 * 3) AI가 실제 후보 안에서 1순위 + 대안 후보를 선택
 * 4) 낮은 신뢰도/업종 불일치 후보는 실제 샵플링 상위 분기 안에서 정밀 재선택
 * 5) 네이버는 최종 선택 결과를 보조 검증만 하며 실패해도 결과를 폐기하지 않음
 */
export async function generateShoplingFirstCategoryRecommendations(
  inputs: ProductCategoryInput[],
  options: ShoplingFirstOptions = {},
): Promise<ReliableCategoryRecommendationResult> {
  const generateBase =
    options.dependencies?.generateBase ??
    generateReliableShoplingCategoryRecommendations;

  const base = await generateBase(inputs, {
    apiKey: options.apiKey,
    model: options.model,
    fetcher: options.fetcher,
    timeoutMs: options.timeoutMs ?? 45_000,
    useWebSearch: false,
    retryFailedIndividually: options.retryFailedIndividually,
  });

  const inputById = new Map(inputs.map((input) => [input.itemId, input]));
  const accuracyRepairEnabled =
    options.accuracyRepair ?? options.dependencies === undefined;
  const repairedBase = accuracyRepairEnabled
    ? await applyAccuracyBranchRepair(base, inputs, inputById, options)
    : {
        ...base,
        results: base.results.map((result) => ({ ...result, autoApply: false })),
      };

  if (options.validateWithNaver === false || !repairedBase.results.length) {
    return repairedBase;
  }

  const validationTargets = repairedBase.results.filter(
    (result) => Boolean(text(result.selectedPath)) && inputById.has(result.itemId),
  );
  if (!validationTargets.length) {
    return repairedBase;
  }

  const validateNaver =
    options.dependencies?.validateNaver ?? validateShoplingRecommendationWithNaver;
  const settled = await mapWithConcurrencySettled(
    validationTargets,
    NAVER_VALIDATION_CONCURRENCY,
    async (recommendation) => {
      const input = inputById.get(recommendation.itemId)!;
      return validateNaver(input, recommendation, {
        apiKey: options.apiKey,
        model: options.naverModel,
        fetcher: options.fetcher,
        timeoutMs: options.validationTimeoutMs ?? NAVER_VALIDATION_TIMEOUT_MS,
      });
    },
  );

  const validationById = new Map<string, NaverCategoryValidation>();
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled" || !result.value) return;
    validationById.set(validationTargets[index].itemId, result.value);
  });

  return {
    ...repairedBase,
    results: repairedBase.results.map((result) =>
      applyPositiveNaverValidation(result, validationById.get(result.itemId) ?? null),
    ),
  };
}

async function applyAccuracyBranchRepair(
  base: ReliableCategoryRecommendationResult,
  inputs: ProductCategoryInput[],
  inputById: ReadonlyMap<string, ProductCategoryInput>,
  options: ShoplingFirstOptions,
): Promise<ReliableCategoryRecommendationResult> {
  try {
    const snapshot = await fetchShoplingCategorySnapshot();
    if (!snapshot?.categories?.length) {
      return {
        ...base,
        results: base.results.map((result) => ({ ...result, autoApply: false })),
      };
    }

    const branchOptions = buildShoplingBranchOptions(snapshot.categories);
    if (!branchOptions.length) {
      return {
        ...base,
        results: base.results.map((result) => ({ ...result, autoApply: false })),
      };
    }

    const branchPlans = await classifyShoplingBranches(inputs, branchOptions, {
      apiKey: options.apiKey,
      model: options.model,
      fetcher: options.fetcher,
      timeoutMs: 14_000,
    });
    const branchesById = new Map(
      branchPlans.map((plan) => [plan.itemId, plan.branches]),
    );
    const repairTargets = base.results.filter((recommendation) => {
      const branches = branchesById.get(recommendation.itemId) ?? [];
      return (
        inputById.has(recommendation.itemId) &&
        shouldRepairShoplingRecommendation(recommendation, branches)
      );
    });
    if (!repairTargets.length) {
      return {
        ...base,
        results: base.results.map((result) => ({ ...result, autoApply: false })),
      };
    }

    const settled = await mapWithConcurrencySettled(
      repairTargets,
      ACCURACY_REPAIR_CONCURRENCY,
      async (recommendation) => {
        const input = inputById.get(recommendation.itemId)!;
        const branches = branchesById.get(recommendation.itemId) ?? [];
        return repairShoplingRecommendationWithinBranches(
          input,
          recommendation,
          snapshot.categories,
          branches,
          {
            apiKey: options.apiKey,
            model: options.model,
            fetcher: options.fetcher,
            timeoutMs: 14_000,
          },
        );
      },
    );

    const repairedById = new Map<string, ProductCategoryRecommendation>();
    settled.forEach((result, index) => {
      if (result.status !== "fulfilled" || !result.value) return;
      repairedById.set(repairTargets[index].itemId, result.value);
    });

    return {
      ...base,
      results: base.results.map((result) => ({
        ...(repairedById.get(result.itemId) ?? result),
        autoApply: false,
      })),
    };
  } catch {
    // 정밀 분기 보정은 정확도 보강 단계다. 실패해도 기존 샵플링 후보를 보존한다.
    return {
      ...base,
      results: base.results.map((result) => ({ ...result, autoApply: false })),
    };
  }
}

export function applyPositiveNaverValidation(
  recommendation: ProductCategoryRecommendation,
  validation: NaverCategoryValidation | null,
): ProductCategoryRecommendation {
  if (!validation?.supported || validation.confidence < 60) {
    return { ...recommendation, autoApply: false };
  }

  const boost = Math.max(
    2,
    Math.min(8, Math.round((validation.confidence - 50) / 6)),
  );
  const confidence = Math.min(97, recommendation.confidence + boost);
  const reason = [
    text(recommendation.reason),
    "네이버 검색에서도 같은 제품 유형이 확인되어 보조 검증했습니다.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 240);

  return {
    ...recommendation,
    confidence,
    reason,
    autoApply: false,
    marketEvidence: {
      status: "web",
      confidence: validation.confidence,
      summary: validation.summary,
      categoryPaths: validation.categoryPaths.slice(0, 4),
      sourceDomains: validation.sourceDomains.slice(0, 8),
    },
  };
}

export async function validateShoplingRecommendationWithNaver(
  input: ProductCategoryInput,
  recommendation: ProductCategoryRecommendation,
  options: {
    apiKey?: string;
    model?: string;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<NaverCategoryValidation | null> {
  const apiKey = text(options.apiKey ?? (process.env.SHOPLING_CATEGORY_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY));
  if (!apiKey) return null;

  const model = text(
    options.model ??
      process.env.OPENAI_NAVER_CATEGORY_MODEL ??
      "gpt-4.1-mini",
  );
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = Math.min(
    Math.max(5_000, options.timeoutMs ?? NAVER_VALIDATION_TIMEOUT_MS),
    NAVER_VALIDATION_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const candidatePaths = [
      recommendation.selectedPath,
      ...recommendation.alternatives,
      ...recommendation.candidatePaths,
    ]
      .map(text)
      .filter((value, index, array) => value && array.indexOf(value) === index)
      .slice(0, 3);

    const response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 800,
        tools: [
          {
            type: "web_search",
            search_context_size: "low",
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
                "당신은 샵플링 카테고리 추천의 네이버 보조검증 담당자다.",
                "모델명을 네이버에서 검색하고 검색 결과의 제품 유형과 용도를 확인한다.",
                "동일한 판매상품을 반드시 찾을 필요는 없으며, 같은 종류의 제품인지 여부만 보수적으로 판단한다.",
                "이미 선택된 샵플링 경로를 바꾸거나 새로운 샵플링 카테고리를 제안하지 않는다.",
                "selectedPath가 검색 결과의 제품 유형과 명확히 부합할 때만 supported=true로 둔다.",
                "네이버에서 실제 카테고리 경로를 확인할 수 있으면 categoryPaths에 기록하고, 확인하지 못하면 빈 배열로 둔다.",
                "검색 근거가 부족하거나 애매하면 supported=false로 두고 confidence를 낮게 준다.",
                "웹 검색 쿼리는 site:naver.com, site:shopping.naver.com 또는 site:search.shopping.naver.com 제한어를 사용해 네이버 결과를 우선 확인한다.",
              ].join("\n"),
            }],
          },
          {
            role: "user",
            content: [{
              type: "input_text",
              text: JSON.stringify({
                task: "선택된 샵플링 카테고리의 네이버 보조검증",
                itemId: input.itemId,
                modelName: input.productName,
                selectedPath: recommendation.selectedPath,
                candidatePaths,
              }),
            }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "shopling_category_naver_validation",
            strict: true,
            schema: validationSchema(),
          },
        },
      }),
      signal: controller.signal,
    });

    const payload = (await response.json()) as OpenAiResponse;
    if (!response.ok) return null;

    const sourceDomains = extractNaverSourceDomains(payload);
    if (!sourceDomains.length) return null;

    const parsed = parseOpenAiStructuredOutput(payload);
    const row = Array.isArray(parsed.results) ? parsed.results[0] : null;
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const value = row as Record<string, unknown>;
    if (text(value.itemId) !== input.itemId) return null;

    return {
      itemId: input.itemId,
      supported: value.supported === true,
      confidence: Math.max(
        0,
        Math.min(100, Math.round(Number(value.confidence) || 0)),
      ),
      summary: text(value.summary).slice(0, 240),
      categoryPaths: Array.isArray(value.categoryPaths)
        ? value.categoryPaths.map(text).filter(Boolean).slice(0, 4)
        : [],
      sourceDomains,
    };
  } catch {
    // 네이버 검증은 보조 신호일 뿐이다. 검색/네트워크/출력 오류가 기본 추천을 폐기해서는 안 된다.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function validationSchema() {
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
          required: [
            "itemId",
            "supported",
            "confidence",
            "summary",
            "categoryPaths",
          ],
          properties: {
            itemId: { type: "string", minLength: 1 },
            supported: { type: "boolean" },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            summary: { type: "string", minLength: 0, maxLength: 240 },
            categoryPaths: {
              type: "array",
              minItems: 0,
              maxItems: 4,
              items: { type: "string", minLength: 1, maxLength: 240 },
            },
          },
        },
      },
    },
  };
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
        // Ignore malformed search source URLs.
      }
    }
  }
  return [...domains].slice(0, 8);
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
        result[index] = { status: "fulfilled", value: await worker(values[index]) };
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
