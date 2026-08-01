import { randomBytes } from "node:crypto";
import { dispatchGitHubActionsWorkflow } from "./githubActionsDispatch";
import {
  parseProductCategoryInputs,
  shortlistShoplingCategories,
} from "./shoplingCategoryScoring";
import type { ProductCategoryInput } from "./shoplingCategoryScoring";
export {
  parseProductCategoryInputs,
  scoreShoplingCategoryCandidate,
  shortlistShoplingCategories,
} from "./shoplingCategoryScoring";
export type { CategoryCandidate, ProductCategoryInput } from "./shoplingCategoryScoring";

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

function getConfig() {
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
  const token = text(
    process.env.GITHUB_ACTIONS_TOKEN || process.env.GITHUB_ENGINE_DISPATCH_TOKEN,
  );
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error("SHOPLING_CATEGORY_REPO는 owner/repo 형식이어야 합니다.");
  }
  if (!token) {
    throw new Error(
      "GITHUB_ACTIONS_TOKEN 또는 GITHUB_ENGINE_DISPATCH_TOKEN이 필요합니다.",
    );
  }
  const [owner, repoName] = repo.split("/");
  return { repo, owner, repoName, workflow, ref, token };
}

function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function readGithubContent(path: string, optional = false) {
  const config = getConfig();
  const url = `https://api.github.com/repos/${config.owner}/${config.repoName}/contents/${path}?ref=${encodeURIComponent(config.ref)}`;
  const response = await fetch(url, {
    headers: {
      ...githubHeaders(config.token),
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

export async function fetchShoplingCategorySnapshot() {
  const payload = (await readGithubContent(SNAPSHOT_PATH, true)) as
    | ShoplingCategorySnapshot
    | null;
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

export async function fetchShoplingCategoryRefreshStatus() {
  const status = (await readGithubContent(STATUS_PATH, true)) as
    | ShoplingCategoryRefreshStatus
    | null;
  const snapshot = await fetchShoplingCategorySnapshot().catch(() => null);
  const config = getConfig();
  return {
    status: status ?? {
      status: "not_initialized",
      message: "샵플링 카테고리 최초 수집 전입니다.",
      categoryCount: 0,
    },
    snapshot: snapshot
      ? {
          collectedAt: snapshot.collectedAt,
          categoryCount: snapshot.categoryCount,
          hash: snapshot.hash,
        }
      : null,
    actionsUrl: `https://github.com/${config.repo}/actions/workflows/${config.workflow}`,
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
  const config = getConfig();
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

function extractOpenAiOutputText(payload: OpenAiResponse) {
  const direct = text(payload.output_text);
  if (direct) return direct;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && text(content.text)) {
        return text(content.text);
      }
    }
  }
  return "";
}

function recommendationSchema(itemIds: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        minItems: itemIds.length,
        maxItems: itemIds.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["itemId", "selectedPath", "confidence", "reason", "alternatives"],
          properties: {
            itemId: { type: "string", enum: itemIds },
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

export async function generateShoplingCategoryRecommendations(
  inputValue: unknown,
  options: {
    apiKey?: string;
    model?: string;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  } = {},
) {
  const inputs = parseProductCategoryInputs(inputValue);
  const snapshot = await fetchShoplingCategorySnapshot();
  if (!snapshot) {
    throw new Error(
      "샵플링 카테고리 스냅샷이 없습니다. 먼저 카테고리 최신화를 실행하세요.",
    );
  }
  const candidatesByItem = new Map(
    inputs.map((input) => [
      input.itemId,
      shortlistShoplingCategories(input, snapshot.categories),
    ]),
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
                    products: inputs.map((input) => ({
                      ...input,
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
            schema: recommendationSchema(inputs.map((input) => input.itemId)),
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
    const outputText = extractOpenAiOutputText(payload);
    if (!outputText) throw new Error("OpenAI 카테고리 응답이 비어 있습니다.");
    const parsed = JSON.parse(outputText) as { results?: unknown };
    if (!Array.isArray(parsed.results)) {
      throw new Error("OpenAI 카테고리 결과 형식이 올바르지 않습니다.");
    }
    const inputById = new Map(inputs.map((input) => [input.itemId, input]));
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
      results.push({
        itemId,
        modelNumber: inputById.get(itemId)!.modelNumber,
        selectedPath,
        confidence,
        reason: text(row.reason).slice(0, 240),
        alternatives: Array.isArray(row.alternatives)
          ? row.alternatives.map(text).filter((path) => candidatePaths.includes(path)).slice(0, 3)
          : [],
        autoApply: !skippedExisting && confidence >= AUTO_APPLY_CONFIDENCE,
        skippedExisting,
        candidatePaths,
      });
      seen.add(itemId);
    }
    if (results.length !== inputs.length) {
      throw new Error("일부 상품의 AI 카테고리 결과가 누락되었습니다.");
    }
    return {
      status: "success",
      snapshot: {
        collectedAt: snapshot.collectedAt,
        categoryCount: snapshot.categoryCount,
        hash: snapshot.hash,
      },
      autoApplyConfidence: AUTO_APPLY_CONFIDENCE,
      results,
    };
  } finally {
    clearTimeout(timer);
  }
}
