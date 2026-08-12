import type {
  ProductCategoryRecommendation,
  ShoplingCategoryEntry,
} from "./shoplingCategoryCatalog.ts";
import { parseOpenAiStructuredOutput } from "./openAiStructuredOutput.ts";
import {
  scoreShoplingCategoryCandidate,
  type ProductCategoryInput,
} from "./shoplingCategoryScoring.ts";

const BRANCH_DEPTH = 2;
const MAX_BRANCH_OPTIONS = 320;
const MAX_SELECTED_BRANCHES = 2;
const MAX_REPAIR_CANDIDATES = 180;
const LOW_CONFIDENCE_REPAIR_THRESHOLD = 72;

type OpenAiResponse = {
  status?: unknown;
  incomplete_details?: { reason?: unknown };
  output_text?: unknown;
  output?: Array<{
    content?: Array<{ type?: unknown; text?: unknown }>;
  }>;
  error?: { message?: unknown; code?: unknown; type?: unknown };
};

export type ShoplingBranchPlan = {
  itemId: string;
  branches: string[];
};

type AiOptions = {
  apiKey?: string;
  model?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function pathParts(path: string) {
  return text(path)
    .split(/\s*>\s*/g)
    .map(text)
    .filter(Boolean);
}

export function shoplingBranchPrefix(path: string, depth = BRANCH_DEPTH) {
  return pathParts(path).slice(0, Math.max(1, depth)).join(">");
}

export function buildShoplingBranchOptions(
  categories: Pick<ShoplingCategoryEntry, "path">[],
  depth = BRANCH_DEPTH,
) {
  const unique = new Set<string>();
  for (const category of categories) {
    const prefix = shoplingBranchPrefix(category.path, depth);
    if (prefix) unique.add(prefix);
  }
  return [...unique]
    .sort((left, right) => left.localeCompare(right, "ko-KR"))
    .slice(0, MAX_BRANCH_OPTIONS);
}

export function pathMatchesShoplingBranches(path: string, branches: string[]) {
  const normalizedPath = text(path);
  if (!normalizedPath) return false;
  return branches.some((rawBranch) => {
    const branch = text(rawBranch);
    return branch && (normalizedPath === branch || normalizedPath.startsWith(`${branch}>`));
  });
}

export function shouldRepairShoplingRecommendation(
  recommendation: ProductCategoryRecommendation,
  branches: string[],
) {
  if (!text(recommendation.selectedPath) || !branches.length) return false;
  if (!pathMatchesShoplingBranches(recommendation.selectedPath, branches)) return true;
  return recommendation.confidence < LOW_CONFIDENCE_REPAIR_THRESHOLD;
}

export function branchRepairCandidatePaths(
  input: ProductCategoryInput,
  categories: Pick<ShoplingCategoryEntry, "path">[],
  branches: string[],
  existingPaths: string[] = [],
  limit = MAX_REPAIR_CANDIDATES,
) {
  const productText = [input.productName, ...input.optionLabels]
    .map(text)
    .filter(Boolean)
    .join(" ");
  const branchCategories = categories
    .filter((category) => pathMatchesShoplingBranches(category.path, branches))
    .map((category) => ({
      path: text(category.path),
      score: scoreShoplingCategoryCandidate(productText, category.path),
    }))
    .filter((candidate) => candidate.path)
    .sort(
      (left, right) =>
        right.score - left.score || left.path.localeCompare(right.path, "ko-KR"),
    );

  const result: string[] = [];
  const add = (value: string) => {
    const normalized = text(value);
    if (!normalized || result.includes(normalized)) return;
    if (!pathMatchesShoplingBranches(normalized, branches)) return;
    result.push(normalized);
  };

  for (const value of existingPaths) add(value);
  if (branchCategories.length <= limit) {
    for (const candidate of branchCategories) add(candidate.path);
    return result.slice(0, limit);
  }

  // Keep the strongest lexical matches first. The branch itself was already
  // selected semantically by AI, so this ranking only reduces payload size.
  for (const candidate of branchCategories.slice(0, limit)) add(candidate.path);
  return result.slice(0, limit);
}

export async function classifyShoplingBranches(
  inputs: ProductCategoryInput[],
  branchOptions: string[],
  options: AiOptions = {},
): Promise<ShoplingBranchPlan[]> {
  if (!inputs.length || !branchOptions.length) return [];
  const apiKey = text(options.apiKey ?? process.env.OPENAI_API_KEY);
  if (!apiKey) return [];
  const model = text(
    options.model ??
      process.env.OPENAI_SHOPLING_FIRST_CATEGORY_MODEL ??
      process.env.OPENAI_CATEGORY_MODEL ??
      "gpt-4.1-mini",
  );
  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timeoutMs = Math.min(18_000, Math.max(6_000, options.timeoutMs ?? 14_000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: Math.min(6_000, 1_500 + inputs.length * 180),
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: [
                "당신은 샵플링 카테고리의 상위 분기 선택 담당자다.",
                "각 모델명이 실제로 판매될 만한 샵플링 분기 1개를 우선 선택하고, 정말 애매할 때만 보조 분기 1개를 추가한다.",
                "반드시 제공된 branchOptions의 문자열을 그대로 사용한다.",
                "제품의 핵심 정체성, 사용 목적, 사용 장소를 우선하고 색상·재질·수량·규격·'부품/부속품/용품/기타' 같은 넓은 단어의 우연한 일치는 무시한다.",
                "예: 우비는 가구 DIY가 아니라 의류/패션/레저의 우의·비옷 계열, 서랍레일은 정수기 부속품이 아니라 가구/DIY/철물 계열, 책갈피는 문구 계열이다.",
                "후보 분기가 없다고 느껴져도 전혀 다른 업종 분기를 억지로 고르지 말고 가장 가까운 실제 판매 영역만 선택한다.",
              ].join("\n"),
            }],
          },
          {
            role: "user",
            content: [{
              type: "input_text",
              text: JSON.stringify({
                task: "모델명별 실제 샵플링 상위 분기 선택",
                branchOptions,
                products: inputs.map((input) => ({
                  itemId: input.itemId,
                  modelName: input.productName,
                  optionLabels: input.optionLabels,
                })),
              }),
            }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "shopling_branch_selection",
            strict: true,
            schema: branchSelectionSchema(),
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as OpenAiResponse;
    const parsed = parseOpenAiStructuredOutput(payload);
    const rows = Array.isArray(parsed.results) ? parsed.results : [];
    const allowed = new Set(branchOptions);
    const expected = new Set(inputs.map((input) => input.itemId));
    const result: ShoplingBranchPlan[] = [];
    const seen = new Set<string>();
    for (const raw of rows) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      const itemId = text(row.itemId);
      if (!expected.has(itemId) || seen.has(itemId)) continue;
      const branches = Array.isArray(row.branches)
        ? row.branches
            .map(text)
            .filter((value) => allowed.has(value))
            .filter((value, index, array) => array.indexOf(value) === index)
            .slice(0, MAX_SELECTED_BRANCHES)
        : [];
      if (!branches.length) continue;
      result.push({ itemId, branches });
      seen.add(itemId);
    }
    return result;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function repairShoplingRecommendationWithinBranches(
  input: ProductCategoryInput,
  recommendation: ProductCategoryRecommendation,
  categories: Pick<ShoplingCategoryEntry, "path">[],
  branches: string[],
  options: AiOptions = {},
): Promise<ProductCategoryRecommendation | null> {
  const apiKey = text(options.apiKey ?? process.env.OPENAI_API_KEY);
  if (!apiKey || !branches.length) return null;
  const model = text(
    options.model ??
      process.env.OPENAI_SHOPLING_FIRST_CATEGORY_MODEL ??
      process.env.OPENAI_CATEGORY_MODEL ??
      "gpt-4.1-mini",
  );
  const existingPaths = [
    recommendation.selectedPath,
    ...recommendation.alternatives,
    ...recommendation.candidatePaths,
  ];
  const candidatePaths = branchRepairCandidatePaths(
    input,
    categories,
    branches,
    existingPaths,
  );
  if (!candidatePaths.length) return null;

  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timeoutMs = Math.min(18_000, Math.max(6_000, options.timeoutMs ?? 14_000));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 1_100,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: [
                "당신은 샵플링 실제 카테고리 후보의 정밀 재선택 담당자다.",
                "모델명과 옵션이 뜻하는 실제 제품을 먼저 이해한 뒤 candidatePaths 안에서만 1순위와 대안 최대 2개를 선택한다.",
                "색상·재질·수량·규격보다 제품 종류와 용도 일치를 최우선한다.",
                "'부품', '부속품', '용품', '기타' 같은 넓은 단어만 겹친다는 이유로 카테고리를 선택하지 않는다.",
                "가구·의류·문구·가전처럼 업종이 다른 후보는 제품 정체성과 맞지 않으면 절대 선택하지 않는다.",
                "후보에 없는 경로를 새로 만들거나 경로 문구를 수정하지 않는다.",
                "정확한 세부 카테고리가 없으면 같은 사용 목적의 가장 가까운 실제 카테고리를 선택하고 confidence를 낮춘다.",
              ].join("\n"),
            }],
          },
          {
            role: "user",
            content: [{
              type: "input_text",
              text: JSON.stringify({
                task: "샵플링 카테고리 정밀 재선택",
                itemId: input.itemId,
                modelName: input.productName,
                optionLabels: input.optionLabels,
                selectedBranches: branches,
                previousSelection: recommendation.selectedPath,
                candidatePaths,
              }),
            }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "shopling_branch_repair",
            strict: true,
            schema: branchRepairSchema(),
          },
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as OpenAiResponse;
    const parsed = parseOpenAiStructuredOutput(payload);
    const row = Array.isArray(parsed.results) ? parsed.results[0] : null;
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const value = row as Record<string, unknown>;
    if (text(value.itemId) !== input.itemId) return null;
    const selectedPath = text(value.selectedPath);
    if (!candidatePaths.includes(selectedPath)) return null;
    const alternatives = Array.isArray(value.alternatives)
      ? value.alternatives
          .map(text)
          .filter((path) => candidatePaths.includes(path) && path !== selectedPath)
          .filter((path, index, array) => array.indexOf(path) === index)
          .slice(0, 2)
      : [];
    const confidence = Math.max(
      25,
      Math.min(92, Math.round(Number(value.confidence) || recommendation.confidence)),
    );
    return {
      ...recommendation,
      selectedPath,
      confidence,
      reason: text(value.reason).slice(0, 240),
      alternatives,
      candidatePaths: [selectedPath, ...alternatives],
      autoApply: false,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function branchSelectionSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        minItems: 1,
        maxItems: 25,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["itemId", "branches"],
          properties: {
            itemId: { type: "string", minLength: 1 },
            branches: {
              type: "array",
              minItems: 1,
              maxItems: MAX_SELECTED_BRANCHES,
              items: { type: "string", minLength: 1, maxLength: 180 },
            },
          },
        },
      },
    },
  };
}

function branchRepairSchema() {
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
          required: ["itemId", "selectedPath", "confidence", "reason", "alternatives"],
          properties: {
            itemId: { type: "string", minLength: 1 },
            selectedPath: { type: "string", minLength: 1, maxLength: 300 },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            reason: { type: "string", minLength: 1, maxLength: 240 },
            alternatives: {
              type: "array",
              minItems: 0,
              maxItems: 2,
              items: { type: "string", minLength: 1, maxLength: 300 },
            },
          },
        },
      },
    },
  };
}
