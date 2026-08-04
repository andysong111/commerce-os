import { randomBytes } from "node:crypto";
import { dispatchGitHubActionsWorkflow } from "./githubActionsDispatch";
import { readShoplingCategoryCatalogFromSupabase } from "./shoplingCategorySupabaseStore";
import {
  canAutoApplyShoplingCategory,
  normalizeShoplingCategorySearchProfiles,
  parseProductCategoryInputs,
  shortlistShoplingCategories,
} from "./shoplingCategoryScoring";
import type {
  ProductCategoryInput,
  ShoplingCategorySearchProfile,
} from "./shoplingCategoryScoring";
import { parseOpenAiStructuredOutput } from "./openAiStructuredOutput";
export {
  parseProductCategoryInputs,
  scoreShoplingCategoryCandidate,
  shortlistShoplingCategories,
} from "./shoplingCategoryScoring";
export type { CategoryCandidate, ProductCategoryInput } from "./shoplingCategoryScoring";
export type { ShoplingCategorySearchProfile } from "./shoplingCategoryScoring";

export type ShoplingCategoryEntry = {
  depth: number;
  path: string;
  names: string[];
  codes: string[];
  largeCode?: string;
  largeName?: string;
  middleCode?: string;
  middleName?: string;
  smallCode?: string;
  smallName?: string;
  detailCode?: string;
  detailName?: string;
};

export type ShoplingCategorySnapshot = {
  schemaVersion: number;
  source: string;
  status: "success";
  requestId?: string;
  collectedAt: string;
  categoryPageUrl?: string;
  categoryCount: number;
  hash: string;
  categories: ShoplingCategoryEntry[];
};

export type ShoplingCategoryRefreshStatus = {
  schemaVersion?: number;
  source?: string;
  status: string;
  requestId?: string;
  checkedAt?: string | null;
  categoryPageUrl?: string;
  categoryCount?: number;
  hash?: string;
  message?: string;
};

export type ProductCategoryRecommendation = {
  itemId: string;
  modelNumber: string;
  selectedPath: string;
  confidence: number;
  reason: string;
  alternatives: string[];
  autoApply: boolean;
  skippedExisting: boolean;
  candidatePaths: string[];
  matchKind: "intent" | "core" | "context" | "none";
};

type OpenAiResponse = {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }>;
  error?: { message?: unknown };
};

const DEFAULT_REPO = "andysong111/shopling-product-upload-auto";
const DEFAULT_WORKFLOW = "shopling-category-refresh.yml";
const SNAPSHOT_PATH = "data/shopling_categories/latest.json";
const STATUS_PATH = "data/shopling_categories/status.json";
const AUTO_APPLY_CONFIDENCE = 90;

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function getRepoConfig() {
  const repo = text(
    process.env.SHOPLING_CATEGORY_REPO ||
      process.env.SHOPLING_UPLOAD_REPO ||
      DEFAULT_REPO,
  );
  const workflow = text(
    process.env.SHOPLING_CATEGORY_WORKFLOW || DEFAULT_WORKFLOW,
  );
  const ref = text(
    process.env.SHOPLING_CATEGORY_REF || process.env.SHOPLING_UPLOAD_REF || "main",
  );
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error("SHOPLING_CATEGORY_REPO는 owner/repo 형식이어야 합니다.");
  }
  const [owner, repoName] = repo.split("/");
  return { repo, owner, repoName, workflow, ref };
}

function getDispatchConfig() {
  const config = getRepoConfig();
  const token = text(
    process.env.GITHUB_ACTIONS_TOKEN || process.env.GITHUB_ENGINE_DISPATCH_TOKEN,
  );
  if (!token) {
    throw new Error(
      "GITHUB_ACTIONS_TOKEN 또는 GITHUB_ENGINE_DISPATCH_TOKEN이 필요합니다.",
    );
  }
  return { ...config, token };
}

function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function readGithubContent(path: string, optional = false) {
  const config = getRepoConfig();
  const token = text(
    process.env.GITHUB_ACTIONS_TOKEN || process.env.GITHUB_ENGINE_DISPATCH_TOKEN,
  );
  if (!token) return optional ? null : Promise.reject(new Error("GitHub 읽기 토큰이 없습니다."));
  const url = `https://api.github.com/repos/${config.owner}/${config.repoName}/contents/${path}?ref=${encodeURIComponent(config.ref)}`;
  const response = await fetch(url, {
    headers: {
      ...githubHeaders(token),
      Accept: "application/vnd.github.raw+json",
    },
    cache: "no-store",
  });
  if (optional && response.status === 404) return null;
  const raw = await response.text();
  if (!response.ok) {
    let message = "";
    try {
      message = text((JSON.parse(raw) as { message?: unknown }).message);
    } catch {
      message = text(raw);
    }
    throw new Error(
      message || `GitHub 파일 조회에 실패했습니다. HTTP ${response.status}`,
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("GitHub 카테고리 JSON 형식이 올바르지 않습니다.");
  }
}

function normalizeSnapshot(payload: ShoplingCategorySnapshot | null) {
  if (!payload) return null;
  if (
    payload.status !== "success" ||
    !Array.isArray(payload.categories) ||
    !payload.categories.length
  ) {
    throw new Error("샵플링 카테고리 스냅샷이 비어 있습니다.");
  }
  return {
    ...payload,
    categories: payload.categories
      .filter((entry) => text(entry?.path))
      .map((entry) => ({
        ...entry,
        path: text(entry.path),
        names: Array.isArray(entry.names) ? entry.names.map(text).filter(Boolean) : [],
        codes: Array.isArray(entry.codes) ? entry.codes.map(text).filter(Boolean) : [],
      })),
  };
}

export async function fetchShoplingCategorySnapshot() {
  const supabaseCatalog = await readShoplingCategoryCatalogFromSupabase().catch(
    () => null,
  );
  if (supabaseCatalog?.snapshot) {
    return normalizeSnapshot(supabaseCatalog.snapshot);
  }

  const fallback = (await readGithubContent(SNAPSHOT_PATH, true).catch(() => null)) as
    | ShoplingCategorySnapshot
    | null;
  return normalizeSnapshot(fallback);
}

export async function fetchShoplingCategoryRefreshStatus() {
  const config = getRepoConfig();
  const supabaseCatalog = await readShoplingCategoryCatalogFromSupabase().catch(
    () => null,
  );
  if (supabaseCatalog?.status || supabaseCatalog?.snapshot) {
    const snapshot = normalizeSnapshot(supabaseCatalog.snapshot);
    return {
      status: supabaseCatalog.status ?? {
        status: snapshot ? "success" : "not_initialized",
        message: snapshot
          ? "샵플링 카테고리 업데이트가 완료됐습니다."
          : "샵플링 카테고리 최초 수집 전입니다.",
        categoryCount: snapshot?.categoryCount ?? 0,
      },
      snapshot: snapshot
        ? {
            collectedAt: snapshot.collectedAt,
            categoryCount: snapshot.categoryCount,
            hash: snapshot.hash,
          }
        : null,
      actionsUrl: `https://github.com/${config.repo}/actions/workflows/${config.workflow}`,
      storage: "supabase" as const,
    };
  }

  const fallbackStatus = (await readGithubContent(STATUS_PATH, true).catch(
    () => null,
  )) as ShoplingCategoryRefreshStatus | null;
  const fallbackSnapshot = await (async () => {
    try {
      const payload = (await readGithubContent(SNAPSHOT_PATH, true)) as
        | ShoplingCategorySnapshot
        | null;
      return normalizeSnapshot(payload);
    } catch {
      return null;
    }
  })();
  return {
    status: fallbackStatus ?? {
      status: "not_initialized",
      message: "샵플링 카테고리 최초 수집 전입니다.",
      categoryCount: 0,
    },
    snapshot: fallbackSnapshot
      ? {
          collectedAt: fallbackSnapshot.collectedAt,
          categoryCount: fallbackSnapshot.categoryCount,
          hash: fallbackSnapshot.hash,
        }
      : null,
    actionsUrl: `https://github.com/${config.repo}/actions/workflows/${config.workflow}`,
    storage: fallbackSnapshot || fallbackStatus ? ("github_fallback" as const) : ("none" as const),
  };
}

export function generateShoplingCategoryRequestId(now = new Date()) {
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `shopling-category-${timestamp}-${randomBytes(3).toString("hex")}`;
}

export async function dispatchShoplingCategoryRefresh(requestId: string) {
  const config = getDispatchConfig();
  const categoryPageUrl = text(process.env.SHOPLING_CATEGORY_PAGE_URL);
  return dispatchGitHubActionsWorkflow({
    owner: config.owner,
    repo: config.repoName,
    workflowFile: config.workflow,
    ref: config.ref,
    token: config.token,
    inputs: {
      request_id: requestId,
      category_page_url: categoryPageUrl,
    },
  });
}

function recommendationSchema() {
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
          required: ["itemId", "selectedPath", "confidence", "reason", "alternatives"],
          properties: {
            itemId: { type: "string", minLength: 1 },
            selectedPath: { type: "string", minLength: 1, maxLength: 300 },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            reason: { type: "string", minLength: 1, maxLength: 240 },
            alternatives: {
              type: "array",
              minItems: 0,
              maxItems: 3,
              items: { type: "string", minLength: 1, maxLength: 300 },
            },
          },
        },
      },
    },
  };
}

function searchProfileSchema() {
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
          required: [
            "itemId",
            "coreProductTerms",
            "contextTerms",
            "ignoredAttributes",
          ],
          properties: {
            itemId: { type: "string", minLength: 1 },
            coreProductTerms: {
              type: "array",
              minItems: 0,
              maxItems: 6,
              items: { type: "string", minLength: 1, maxLength: 40 },
            },
            contextTerms: {
              type: "array",
              minItems: 0,
              maxItems: 6,
              items: { type: "string", minLength: 1, maxLength: 40 },
            },
            ignoredAttributes: {
              type: "array",
              minItems: 0,
              maxItems: 10,
              items: { type: "string", minLength: 1, maxLength: 40 },
            },
          },
        },
      },
    },
  };
}

export async function generateShoplingCategorySearchProfiles(
  inputs: ProductCategoryInput[],
  options: {
    apiKey?: string;
    model?: string;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<ShoplingCategorySearchProfile[]> {
  const normalizedInputs = parseProductCategoryInputs({ items: inputs });
  const apiKey = text(options.apiKey ?? process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY가 설정되지 않아 모델명 핵심명사를 분석할 수 없습니다.");
  }
  const model = text(
    options.model ??
      process.env.OPENAI_CATEGORY_MODEL ??
      process.env.OPENAI_MODEL ??
      "gpt-5-mini",
  );
  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
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
        max_output_tokens: Math.min(8_000, 1_200 + normalizedInputs.length * 360),
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: [
                  "당신은 한국 온라인쇼핑 카테고리 검색어 설계 담당자다.",
                  "모델명에서 실제로 판매하는 물건의 핵심 제품명사를 찾고, 카테고리 원장에서 검색할 한국어 동의어를 만든다.",
                  "동의어에는 카테고리에서 쓰는 표준 표기와 흔한 표기 차이(예: 브러시/브러쉬)를 포함한다.",
                  "색상·재질·크기·수량·형번·스타일·포장 여부는 핵심 제품명사에서 제외하고 ignoredAttributes에 넣는다.",
                  "제품의 사용 영역이나 대상은 contextTerms에 넣되 효능·인증·구성품을 추측하지 않는다.",
                  "합성어 안의 색상어는 함부로 분리하지 않는다. 블랙보드와 블랙박스는 각각 완전한 제품명사다.",
                  "예: '걸이형 모공브러쉬 블랙' → coreProductTerms ['모공브러쉬','모공브러시','세안브러시','클렌징브러시','페이스브러시','화장용브러시'], contextTerms ['세안','클렌징','뷰티','퍼스널케어'], ignoredAttributes ['걸이형','블랙'].",
                  "예: '사이드 테이블 블랙' → coreProductTerms ['사이드테이블','테이블'], ignoredAttributes ['블랙'].",
                  "예: '투구골무' → coreProductTerms ['골무','재봉골무'], contextTerms ['수예','바느질'].",
                  "각 배열은 관련성이 높은 순서이며, 근거가 없으면 빈 배열로 둔다.",
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
                  task: "모델명별 카테고리 검색 프로필 생성",
                  products: normalizedInputs.map((input) => ({
                    itemId: input.itemId,
                    modelNumber: input.modelNumber,
                    modelName: input.productName,
                    optionLabels: input.optionLabels,
                  })),
                }),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "shopling_category_search_profiles",
            strict: true,
            schema: searchProfileSchema(),
          },
        },
      }),
      signal: controller.signal,
    });
    const payload = (await response.json()) as OpenAiResponse;
    if (!response.ok) {
      throw new Error(
        text(payload.error?.message) ||
          `OpenAI 모델명 분석 요청이 실패했습니다. HTTP ${response.status}`,
      );
    }
    const parsed = parseOpenAiStructuredOutput(payload);
    if (!Array.isArray(parsed.results)) {
      throw new Error("OpenAI 모델명 분석 결과 형식이 올바르지 않습니다.");
    }
    return normalizeShoplingCategorySearchProfiles(
      parsed.results,
      normalizedInputs,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function generateShoplingCategoryRecommendations(
  inputValue: unknown,
  options: {
    apiKey?: string;
    model?: string;
    fetcher?: typeof fetch;
    timeoutMs?: number;
    searchProfiles?: ReadonlyMap<string, ShoplingCategorySearchProfile>;
  } = {},
) {
  const inputs = parseProductCategoryInputs(inputValue);
  const snapshot = await fetchShoplingCategorySnapshot();
  if (!snapshot) {
    throw new Error(
      "샵플링 카테고리 스냅샷이 없습니다. 먼저 카테고리 업데이트를 실행하세요.",
    );
  }
  const candidatesByItem = new Map(
    inputs.map((input) => [
      input.itemId,
      shortlistShoplingCategories(
        input,
        snapshot.categories,
        undefined,
        options.searchProfiles?.get(input.itemId),
      ),
    ]),
  );
  const supportedInputs = inputs.filter(
    (input) => (candidatesByItem.get(input.itemId)?.length ?? 0) > 0,
  );
  const unsupportedInputs = inputs.filter(
    (input) => (candidatesByItem.get(input.itemId)?.length ?? 0) === 0,
  );
  const apiKey = text(options.apiKey ?? process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY가 설정되지 않아 AI 카테고리를 추천할 수 없습니다.");
  }
  const model = text(
    options.model ??
      process.env.OPENAI_CATEGORY_MODEL ??
      process.env.OPENAI_MODEL ??
      "gpt-5-mini",
  );
  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 60_000,
  );
  try {
    if (!supportedInputs.length) {
      return {
        status: "success" as const,
        snapshot: {
          collectedAt: snapshot.collectedAt,
          categoryCount: snapshot.categoryCount,
          hash: snapshot.hash,
        },
        autoApplyConfidence: AUTO_APPLY_CONFIDENCE,
        results: unsupportedInputs.map((input) => noMatchRecommendation(input)),
      };
    }
    const response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 2600,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: [
                  "당신은 샵플링 표준카테고리 분류 담당자다.",
                  "각 상품은 제공된 candidatePaths 중 정확히 하나만 선택한다.",
                  "후보에 없는 경로를 새로 만들거나 철자를 바꾸지 않는다.",
                  "모델명과 옵션이 증명하는 상품 정체성만 사용하고 용도·재질·효능을 추측하지 않는다.",
                  "애매하면 confidence를 낮게 주고 alternatives에 가까운 후보를 넣는다.",
                  "이미 카테고리가 있는 상품도 추천은 하되 기존값을 존중한다.",
                ].join("\n"),
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(
                  {
                    task: "상품별 샵플링 표준카테고리 선택",
                    snapshotHash: snapshot.hash,
                    products: supportedInputs.map((input) => ({
                      ...input,
                      categorySearchProfile:
                        options.searchProfiles?.get(input.itemId) ?? null,
                      candidatePaths: candidatesByItem
                        .get(input.itemId)!
                        .map((candidate) => candidate.path),
                    })),
                  },
                  null,
                  2,
                ),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "shopling_category_recommendations",
            strict: true,
            schema: recommendationSchema(),
          },
        },
      }),
      signal: controller.signal,
    });
    const payload = (await response.json()) as OpenAiResponse;
    if (!response.ok) {
      throw new Error(
        text(payload.error?.message) ||
          `OpenAI API 요청이 실패했습니다. HTTP ${response.status}`,
      );
    }
    const parsed = parseOpenAiStructuredOutput(payload);
    if (!Array.isArray(parsed.results)) {
      throw new Error("OpenAI 카테고리 결과 형식이 올바르지 않습니다.");
    }
    const inputById = new Map(
      supportedInputs.map((input) => [input.itemId, input]),
    );
    const results: ProductCategoryRecommendation[] = [];
    const seen = new Set<string>();
    for (const raw of parsed.results) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      const itemId = text(row.itemId);
      if (!inputById.has(itemId) || seen.has(itemId)) continue;
      const candidatePaths = candidatesByItem
        .get(itemId)!
        .map((candidate) => candidate.path);
      const selectedPath = text(row.selectedPath);
      if (!candidatePaths.includes(selectedPath)) {
        throw new Error(`${itemId}의 AI 결과가 최신 카테고리 후보에 없습니다.`);
      }
      const confidence = Math.max(0, Math.min(100, Math.round(Number(row.confidence) || 0)));
      const currentCategory = inputById.get(itemId)!.currentCategory;
      const skippedExisting = Boolean(currentCategory);
      const selectedCandidate = candidatesByItem
        .get(itemId)!
        .find((candidate) => candidate.path === selectedPath)!;
      const matchKind = selectedCandidate.matchKind ?? "context";
      results.push({
        itemId,
        modelNumber: inputById.get(itemId)!.modelNumber,
        selectedPath,
        confidence,
        reason: text(row.reason).slice(0, 240),
        alternatives: Array.isArray(row.alternatives)
          ? row.alternatives.map(text).filter((path) => candidatePaths.includes(path)).slice(0, 3)
          : [],
        autoApply: canAutoApplyShoplingCategory({
          confidence,
          currentCategory,
          matchKind,
        }),
        skippedExisting,
        candidatePaths,
        matchKind,
      });
      seen.add(itemId);
    }
    if (results.length !== supportedInputs.length) {
      throw new Error("일부 상품의 AI 카테고리 결과가 누락되었습니다.");
    }
    const resultById = new Map(results.map((result) => [result.itemId, result]));
    for (const input of unsupportedInputs) {
      resultById.set(input.itemId, noMatchRecommendation(input));
    }
    return {
      status: "success",
      snapshot: {
        collectedAt: snapshot.collectedAt,
        categoryCount: snapshot.categoryCount,
        hash: snapshot.hash,
      },
      autoApplyConfidence: AUTO_APPLY_CONFIDENCE,
      results: inputs.map((input) => resultById.get(input.itemId)!),
    };
  } finally {
    clearTimeout(timer);
  }
}

function noMatchRecommendation(
  input: ProductCategoryInput,
): ProductCategoryRecommendation {
  return {
    itemId: input.itemId,
    modelNumber: input.modelNumber,
    selectedPath: "",
    confidence: 0,
    reason:
      "모델명의 핵심 제품명사 및 용도와 일치하는 샵플링 표준카테고리를 찾지 못했습니다. 엉뚱한 후보는 제시하지 않고 검토 상태로 남겼습니다.",
    alternatives: [],
    autoApply: false,
    skippedExisting: Boolean(input.currentCategory),
    candidatePaths: [],
    matchKind: "none",
  };
}
