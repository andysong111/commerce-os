import {
  fetchShoplingCategorySnapshot,
  type ProductCategoryMarketEvidence,
  type ProductCategoryRecommendation,
} from "@/lib/shoplingCategoryCatalog";
import {
  findShoplingCategoryApprovalPrior,
  type ShoplingCategoryApprovalExample,
} from "@/lib/shoplingCategoryLearning";
import { parseOpenAiStructuredOutput } from "@/lib/openAiStructuredOutput";
import type { ReliableCategoryRecommendationResult } from "@/lib/shoplingCategoryRecommendationRunner";
import type { ProductCategoryInput } from "@/lib/shoplingCategoryScoring";

const LEAF_VALIDATION_TIMEOUT_MS = 22_000;
const NAVER_RERANK_TIMEOUT_MS = 14_000;
const IMAGE_FALLBACK_TIMEOUT_MS = 14_000;
const NAVER_CONCURRENCY = 3;
const IMAGE_CONCURRENCY = 2;

export type ShoplingAccuracyInput = ProductCategoryInput & {
  imageUrl?: string;
};

type AccuracyOptions = {
  approvalExamples?: readonly ShoplingCategoryApprovalExample[];
  apiKey?: string;
  model?: string;
  naverModel?: string;
  fetcher?: typeof fetch;
};

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

type LeafValidationRow = {
  itemId: string;
  selectedPath: string;
  alternatives: string[];
  confidence: number;
  reason: string;
};

type CandidateRerank = {
  itemId: string;
  preferredPath: string;
  supported: boolean;
  confidence: number;
  summary: string;
  categoryPaths: string[];
  sourceDomains: string[];
};

type ImageRerank = {
  itemId: string;
  preferredPath: string;
  confidence: number;
  summary: string;
};

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function uniquePaths(values: unknown[], limit = 6) {
  const result: string[] = [];
  for (const raw of values) {
    const value = text(raw);
    if (!value || result.includes(value)) continue;
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function candidatePool(
  recommendation: ProductCategoryRecommendation,
  approvalPrior = "",
  limit = 6,
) {
  return uniquePaths(
    [
      approvalPrior,
      recommendation.selectedPath,
      ...recommendation.alternatives,
      ...recommendation.candidatePaths,
    ],
    limit,
  );
}

function withCandidateOrder(
  recommendation: ProductCategoryRecommendation,
  selectedPath: string,
  ordered: string[],
  confidence: number,
  reason: string,
) {
  const pool = uniquePaths([selectedPath, ...ordered], 6);
  const selected = pool[0] || recommendation.selectedPath;
  const alternatives = pool.filter((path) => path !== selected).slice(0, 2);
  return {
    ...recommendation,
    selectedPath: selected,
    alternatives,
    candidatePaths: [selected, ...alternatives],
    confidence: Math.max(0, Math.min(97, Math.round(confidence))),
    reason: text(reason).slice(0, 240) || recommendation.reason,
    autoApply: false,
  };
}

export async function enhanceShoplingCategoryRecommendations(
  inputs: ShoplingAccuracyInput[],
  generated: ReliableCategoryRecommendationResult,
  options: AccuracyOptions = {},
): Promise<ReliableCategoryRecommendationResult> {
  if (!generated.results.length) return generated;
  const snapshot = await fetchShoplingCategorySnapshot().catch(() => null);
  if (!snapshot?.categories?.length) return generated;
  const validPaths = new Set(snapshot.categories.map((entry) => text(entry.path)).filter(Boolean));
  const inputById = new Map(inputs.map((input) => [input.itemId, input]));

  const priorById = new Map<string, string>();
  const priorAdjusted = generated.results.map((recommendation) => {
    const input = inputById.get(recommendation.itemId);
    if (!input) return recommendation;
    const prior = findShoplingCategoryApprovalPrior(
      input,
      options.approvalExamples ?? [],
      validPaths,
    );
    if (!prior) return recommendation;
    priorById.set(recommendation.itemId, prior.path);
    const pool = candidatePool(recommendation, prior.path);
    const useAsLead = prior.similarity >= 0.86;
    const selected = useAsLead ? prior.path : recommendation.selectedPath;
    const reason = useAsLead
      ? `과거 승인 정답 중 유사 모델(${Math.round(prior.similarity * 100)}%, ${prior.supportCount}건)의 실제 샵플링 경로를 우선 후보로 반영했습니다. ${recommendation.reason}`
      : `과거 승인 정답의 유사 경로를 정밀 검증 후보에 추가했습니다. ${recommendation.reason}`;
    return withCandidateOrder(
      recommendation,
      selected,
      pool,
      useAsLead ? Math.max(recommendation.confidence, 72) : recommendation.confidence,
      reason,
    );
  });

  const leafValidated = await validateLeafCandidates(
    inputs,
    priorAdjusted,
    priorById,
    options,
  );
  const naverReranked = await rerankCandidatesWithNaver(inputs, leafValidated, options);
  const imageReranked = await rerankLowConfidenceWithImages(
    inputs,
    naverReranked,
    options,
  );

  return {
    ...generated,
    results: imageReranked,
  };
}

async function validateLeafCandidates(
  inputs: ShoplingAccuracyInput[],
  recommendations: ProductCategoryRecommendation[],
  priorById: ReadonlyMap<string, string>,
  options: AccuracyOptions,
) {
  const apiKey = text(options.apiKey ?? process.env.OPENAI_API_KEY);
  if (!apiKey) return recommendations;
  const model = text(
    options.model ??
      process.env.OPENAI_SHOPLING_FIRST_CATEGORY_MODEL ??
      process.env.OPENAI_CATEGORY_MODEL ??
      "gpt-4.1-mini",
  );
  const inputById = new Map(inputs.map((input) => [input.itemId, input]));
  const payloadProducts = recommendations
    .map((recommendation) => {
      const input = inputById.get(recommendation.itemId);
      if (!input) return null;
      const paths = candidatePool(
        recommendation,
        priorById.get(recommendation.itemId) ?? "",
        5,
      );
      return paths.length
        ? {
            itemId: recommendation.itemId,
            modelName: input.productName,
            optionLabels: input.optionLabels,
            candidatePaths: paths,
          }
        : null;
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  if (!payloadProducts.length) return recommendations;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LEAF_VALIDATION_TIMEOUT_MS);
  try {
    const fetcher = options.fetcher ?? fetch;
    const response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: Math.min(7_000, 1_500 + payloadProducts.length * 260),
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: [
                  "당신은 샵플링 실제 카테고리의 leaf 단계 최종 검증자다.",
                  "각 제품의 모델명과 옵션이 뜻하는 실제 제품 정체성·용도·사용장소를 먼저 확정한다.",
                  "그 다음 candidatePaths 각각의 전체 경로와 마지막 leaf 카테고리가 그 제품에 실제로 맞는지 비교한다.",
                  "'용품', '부품', '기타', '브러쉬', '커버'처럼 넓은 단어 하나가 겹친다는 이유만으로 선택하지 않는다.",
                  "업종이 맞더라도 마지막 leaf의 용도가 다르면 다른 후보를 선택한다.",
                  "반드시 제공된 candidatePaths 문자열만 그대로 사용하고 새 카테고리를 만들지 않는다.",
                  "1순위와 대안 최대 2개를 관련성 순서로 정렬한다. 후보가 모두 다소 넓으면 가장 가까운 실제 용도를 고르고 confidence를 낮춘다.",
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
                  task: "제품별 샵플링 leaf 카테고리 최종 검증 및 재정렬",
                  products: payloadProducts,
                }),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "shopling_leaf_validation",
            strict: true,
            schema: leafValidationSchema(payloadProducts.length),
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return recommendations;
    const parsed = parseOpenAiStructuredOutput((await response.json()) as OpenAiResponse);
    const rows = Array.isArray(parsed.results) ? parsed.results : [];
    const allowedById = new Map(
      payloadProducts.map((product) => [product.itemId, new Set(product.candidatePaths)]),
    );
    const verifiedById = new Map<string, LeafValidationRow>();
    for (const raw of rows) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      const itemId = text(row.itemId);
      const allowed = allowedById.get(itemId);
      if (!allowed) continue;
      const selectedPath = text(row.selectedPath);
      if (!allowed.has(selectedPath)) continue;
      const alternatives = Array.isArray(row.alternatives)
        ? row.alternatives
            .map(text)
            .filter((path) => path !== selectedPath && allowed.has(path))
            .filter((path, index, array) => array.indexOf(path) === index)
            .slice(0, 2)
        : [];
      verifiedById.set(itemId, {
        itemId,
        selectedPath,
        alternatives,
        confidence: Math.max(20, Math.min(95, Math.round(Number(row.confidence) || 0))),
        reason: text(row.reason),
      });
    }
    return recommendations.map((recommendation) => {
      const verified = verifiedById.get(recommendation.itemId);
      if (!verified) return recommendation;
      return withCandidateOrder(
        recommendation,
        verified.selectedPath,
        [verified.selectedPath, ...verified.alternatives],
        verified.confidence,
        verified.reason,
      );
    });
  } catch {
    return recommendations;
  } finally {
    clearTimeout(timer);
  }
}

async function rerankCandidatesWithNaver(
  inputs: ShoplingAccuracyInput[],
  recommendations: ProductCategoryRecommendation[],
  options: AccuracyOptions,
) {
  const inputById = new Map(inputs.map((input) => [input.itemId, input]));
  const settled = await mapWithConcurrencySettled(
    recommendations,
    NAVER_CONCURRENCY,
    async (recommendation) => {
      const input = inputById.get(recommendation.itemId);
      if (!input) return null;
      return naverCandidateRerank(input, recommendation, options);
    },
  );
  const byId = new Map<string, CandidateRerank>();
  settled.forEach((result) => {
    if (result.status === "fulfilled" && result.value) {
      byId.set(result.value.itemId, result.value);
    }
  });
  return recommendations.map((recommendation) => {
    const rerank = byId.get(recommendation.itemId);
    if (!rerank?.supported || rerank.confidence < 60) return recommendation;
    const pool = candidatePool(recommendation, "", 3);
    if (!pool.includes(rerank.preferredPath)) return recommendation;
    const reordered = [rerank.preferredPath, ...pool.filter((path) => path !== rerank.preferredPath)];
    const changed = rerank.preferredPath !== recommendation.selectedPath;
    const confidence = changed
      ? Math.max(55, Math.min(92, Math.round((recommendation.confidence + rerank.confidence) / 2)))
      : Math.min(97, recommendation.confidence + Math.max(2, Math.min(8, Math.round((rerank.confidence - 50) / 6))));
    return {
      ...withCandidateOrder(
        recommendation,
        rerank.preferredPath,
        reordered,
        confidence,
        [
          recommendation.reason,
          changed
            ? "네이버 검색 결과의 제품 유형을 후보 1·2·3과 비교해 더 가까운 실제 샵플링 후보로 순서를 재조정했습니다."
            : "네이버 검색 결과에서도 현재 1순위 후보의 제품 유형이 확인됐습니다.",
        ]
          .filter(Boolean)
          .join(" "),
      ),
      marketEvidence: {
        status: "web",
        confidence: rerank.confidence,
        summary: rerank.summary,
        categoryPaths: rerank.categoryPaths.slice(0, 4),
        sourceDomains: rerank.sourceDomains.slice(0, 8),
      } satisfies ProductCategoryMarketEvidence,
    };
  });
}

async function naverCandidateRerank(
  input: ShoplingAccuracyInput,
  recommendation: ProductCategoryRecommendation,
  options: AccuracyOptions,
): Promise<CandidateRerank | null> {
  const apiKey = text(options.apiKey ?? process.env.OPENAI_API_KEY);
  if (!apiKey) return null;
  const candidatePaths = candidatePool(recommendation, "", 3);
  if (candidatePaths.length < 2) return null;
  const model = text(
    options.naverModel ?? process.env.OPENAI_NAVER_CATEGORY_MODEL ?? "gpt-4.1-mini",
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NAVER_RERANK_TIMEOUT_MS);
  try {
    const fetcher = options.fetcher ?? fetch;
    const response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 900,
        tools: [{ type: "web_search", search_context_size: "low" }],
        tool_choice: "required",
        include: ["web_search_call.action.sources"],
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: [
                  "당신은 샵플링 후보 3개의 네이버 기반 재랭킹 담당자다.",
                  "모델명을 네이버에서 검색해 같은 종류 제품의 실제 용도와 카테고리 맥락을 확인한다.",
                  "동일 판매상품을 반드시 찾을 필요는 없다. 같은 제품 종류인지가 핵심이다.",
                  "새 샵플링 경로를 만들지 않고 candidatePaths 중 어떤 후보가 가장 가까운지만 판단한다.",
                  "네이버 근거가 부족하면 supported=false, preferredPath=''로 둔다.",
                  "site:naver.com, site:shopping.naver.com, site:search.shopping.naver.com 제한어를 활용해 네이버 결과를 우선한다.",
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
                  task: "네이버 제품 유형 근거로 샵플링 후보 재랭킹",
                  itemId: input.itemId,
                  modelName: input.productName,
                  optionLabels: input.optionLabels,
                  candidatePaths,
                }),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "shopling_naver_candidate_rerank",
            strict: true,
            schema: candidateRerankSchema(),
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as OpenAiResponse;
    const sourceDomains = extractNaverSourceDomains(payload);
    if (!sourceDomains.length) return null;
    const parsed = parseOpenAiStructuredOutput(payload);
    const row = Array.isArray(parsed.results) ? parsed.results[0] : null;
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const value = row as Record<string, unknown>;
    if (text(value.itemId) !== input.itemId) return null;
    const preferredPath = text(value.preferredPath);
    const supported = value.supported === true && candidatePaths.includes(preferredPath);
    return {
      itemId: input.itemId,
      preferredPath: supported ? preferredPath : "",
      supported,
      confidence: Math.max(0, Math.min(100, Math.round(Number(value.confidence) || 0))),
      summary: text(value.summary).slice(0, 240),
      categoryPaths: Array.isArray(value.categoryPaths)
        ? value.categoryPaths.map(text).filter(Boolean).slice(0, 4)
        : [],
      sourceDomains,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function rerankLowConfidenceWithImages(
  inputs: ShoplingAccuracyInput[],
  recommendations: ProductCategoryRecommendation[],
  options: AccuracyOptions,
) {
  const inputById = new Map(inputs.map((input) => [input.itemId, input]));
  const targets = recommendations.filter((recommendation) => {
    const input = inputById.get(recommendation.itemId);
    return Boolean(input && validImageUrl(input.imageUrl) && recommendation.confidence < 55);
  });
  if (!targets.length) return recommendations;
  const settled = await mapWithConcurrencySettled(
    targets,
    IMAGE_CONCURRENCY,
    async (recommendation) => {
      const input = inputById.get(recommendation.itemId)!;
      return imageCandidateRerank(input, recommendation, options);
    },
  );
  const byId = new Map<string, ImageRerank>();
  settled.forEach((result) => {
    if (result.status === "fulfilled" && result.value) byId.set(result.value.itemId, result.value);
  });
  return recommendations.map((recommendation) => {
    const image = byId.get(recommendation.itemId);
    if (!image || image.confidence < 65) return recommendation;
    const pool = candidatePool(recommendation, "", 3);
    if (!pool.includes(image.preferredPath)) return recommendation;
    return withCandidateOrder(
      recommendation,
      image.preferredPath,
      [image.preferredPath, ...pool.filter((path) => path !== image.preferredPath)],
      Math.max(recommendation.confidence, Math.min(88, image.confidence)),
      `${recommendation.reason} 텍스트 신뢰도가 낮아 대표이미지를 보조 확인했고, 시각적 제품 정체성 기준으로 후보 순서를 보정했습니다.`,
    );
  });
}

async function imageCandidateRerank(
  input: ShoplingAccuracyInput,
  recommendation: ProductCategoryRecommendation,
  options: AccuracyOptions,
): Promise<ImageRerank | null> {
  const apiKey = text(options.apiKey ?? process.env.OPENAI_API_KEY);
  const imageUrl = validImageUrl(input.imageUrl) ? text(input.imageUrl) : "";
  if (!apiKey || !imageUrl) return null;
  const candidatePaths = candidatePool(recommendation, "", 3);
  if (candidatePaths.length < 2) return null;
  const model = text(
    options.model ??
      process.env.OPENAI_SHOPLING_FIRST_CATEGORY_MODEL ??
      process.env.OPENAI_CATEGORY_MODEL ??
      "gpt-4.1-mini",
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FALLBACK_TIMEOUT_MS);
  try {
    const fetcher = options.fetcher ?? fetch;
    const response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 650,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: "텍스트 분류가 애매한 상품의 대표이미지를 보조 확인한다. 이미지에서 실제 제품 종류와 용도를 확인하되 candidatePaths 안에서만 가장 가까운 후보를 고른다. 색상·배경·장식보다 물체의 정체성을 우선한다.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  itemId: input.itemId,
                  modelName: input.productName,
                  candidatePaths,
                }),
              },
              { type: "input_image", image_url: imageUrl, detail: "low" },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "shopling_image_candidate_rerank",
            strict: true,
            schema: imageRerankSchema(),
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const parsed = parseOpenAiStructuredOutput((await response.json()) as OpenAiResponse);
    const row = Array.isArray(parsed.results) ? parsed.results[0] : null;
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const value = row as Record<string, unknown>;
    if (text(value.itemId) !== input.itemId) return null;
    const preferredPath = text(value.preferredPath);
    if (!candidatePaths.includes(preferredPath)) return null;
    return {
      itemId: input.itemId,
      preferredPath,
      confidence: Math.max(0, Math.min(100, Math.round(Number(value.confidence) || 0))),
      summary: text(value.summary).slice(0, 200),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function validImageUrl(value: unknown) {
  const url = text(value);
  return /^https:\/\/[^\s]+$/i.test(url) && url.length <= 2_000;
}

function extractNaverSourceDomains(payload: OpenAiResponse) {
  const domains: string[] = [];
  for (const item of payload.output ?? []) {
    for (const source of item.action?.sources ?? []) {
      const url = text(source.url);
      if (!url) continue;
      try {
        const host = new URL(url).hostname.toLocaleLowerCase("en-US").replace(/^www\./, "");
        if (!/(^|\.)naver\.com$/.test(host)) continue;
        if (!domains.includes(host)) domains.push(host);
      } catch {
        // Ignore malformed source URLs.
      }
    }
  }
  return domains.slice(0, 8);
}

function leafValidationSchema(maxItems: number) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        minItems: 1,
        maxItems: Math.max(1, Math.min(25, maxItems)),
        items: {
          type: "object",
          additionalProperties: false,
          required: ["itemId", "selectedPath", "alternatives", "confidence", "reason"],
          properties: {
            itemId: { type: "string", minLength: 1 },
            selectedPath: { type: "string", minLength: 1, maxLength: 400 },
            alternatives: {
              type: "array",
              minItems: 0,
              maxItems: 2,
              items: { type: "string", minLength: 1, maxLength: 400 },
            },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            reason: { type: "string", minLength: 1, maxLength: 240 },
          },
        },
      },
    },
  };
}

function candidateRerankSchema() {
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
            "preferredPath",
            "supported",
            "confidence",
            "summary",
            "categoryPaths",
          ],
          properties: {
            itemId: { type: "string", minLength: 1 },
            preferredPath: { type: "string", maxLength: 400 },
            supported: { type: "boolean" },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            summary: { type: "string", maxLength: 240 },
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

function imageRerankSchema() {
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
          required: ["itemId", "preferredPath", "confidence", "summary"],
          properties: {
            itemId: { type: "string", minLength: 1 },
            preferredPath: { type: "string", minLength: 1, maxLength: 400 },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            summary: { type: "string", maxLength: 200 },
          },
        },
      },
    },
  };
}

async function mapWithConcurrencySettled<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const result: PromiseSettledResult<R>[] = new Array(values.length);
  let cursor = 0;
  async function run() {
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
    Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, () => run()),
  );
  return result;
}
