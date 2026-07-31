import { extendedModuleRegistry } from "@/lib/extendedModuleRegistry";
import {
  isOpsHelpActionRequest,
  normalizeOpsHelpText,
  selectOpsAiKnowledge,
  STATIC_OPS_AI_KNOWLEDGE,
  type OpsAiKnowledgeSection,
  type OpsAiPageContext,
} from "@/lib/opsAiKnowledge";

export type OpsAiHelpHistoryItem = {
  role: "user" | "assistant";
  text: string;
};

export type OpsAiHelpInput = {
  question: string;
  page: OpsAiPageContext;
  history: OpsAiHelpHistoryItem[];
};

export type OpsAiHelpSource = {
  id: string;
  title: string;
  route: string | null;
  version: string;
};

export type OpsAiHelpResult = {
  status: "answered" | "out_of_scope" | "insufficient_evidence";
  answer: string;
  steps: string[];
  warnings: string[];
  sources: OpsAiHelpSource[];
  cached: boolean;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

type OpenAiFetch = typeof fetch;

type OpenAiPayload = {
  output_text?: unknown;
  output?: Array<{
    content?: Array<{ type?: unknown; text?: unknown }>;
  }>;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    total_tokens?: unknown;
  };
  error?: { message?: unknown };
};

type RawModelAnswer = {
  status?: unknown;
  answer?: unknown;
  steps?: unknown;
  warnings?: unknown;
  source_ids?: unknown;
};

type CacheEntry = {
  expiresAt: number;
  result: Omit<OpsAiHelpResult, "cached">;
};

const answerCache = new Map<string, CacheEntry>();
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 200;

function limitedText(value: unknown, maxLength: number) {
  return normalizeOpsHelpText(value).slice(0, maxLength);
}

function uniqueTextArray(value: unknown, limit: number, maxLength: number) {
  const values = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of values) {
    const normalized = limitedText(item, maxLength);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

export function parseOpsAiHelpInput(value: unknown): OpsAiHelpInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("질문 요청 형식이 올바르지 않습니다.");
  }
  const source = value as Record<string, unknown>;
  const question = limitedText(source.question, 1_000);
  if (!question) throw new Error("궁금한 사용법을 입력하세요.");

  const rawPage =
    source.page && typeof source.page === "object" && !Array.isArray(source.page)
      ? (source.page as Record<string, unknown>)
      : {};
  const pathname = limitedText(rawPage.pathname, 240) || "/";
  const page: OpsAiPageContext = {
    pathname: pathname.startsWith("/") ? pathname : "/",
    title: limitedText(rawPage.title, 160),
    url: limitedText(rawPage.url, 500),
  };

  const rawHistory = Array.isArray(source.history) ? source.history.slice(-6) : [];
  const history: OpsAiHelpHistoryItem[] = [];
  for (const row of rawHistory) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const item = row as Record<string, unknown>;
    const role = item.role === "assistant" ? "assistant" : "user";
    const historyText = limitedText(item.text, 800);
    if (historyText) history.push({ role, text: historyText });
  }

  return { question, page, history };
}

function deployedVersion() {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 12) ||
    process.env.NEXT_PUBLIC_OPS_BUILD_SHA?.trim().slice(0, 12) ||
    "current-build"
  );
}

export function buildOpsAiKnowledgeSections(): OpsAiKnowledgeSection[] {
  const version = deployedVersion();
  const moduleSections = extendedModuleRegistry.map((module) => ({
    id: `module:${module.id}`,
    title: module.title,
    route: module.route,
    keywords: [
      module.id,
      module.title,
      module.navigationLabel ?? "",
      module.category,
      module.inputType,
      module.outputType,
      module.helperNote ?? "",
      module.actionLabel ?? "",
      module.safetyBadge ?? "",
    ].filter(Boolean),
    content: [
      `기능명: ${module.title}`,
      `설명: ${module.description}`,
      `현재 상태: ${module.status}`,
      `입력: ${module.inputType}`,
      `결과: ${module.outputType}`,
      module.actionLabel ? `화면의 주요 동작: ${module.actionLabel}` : "",
      module.safetyBadge ? `안전 표시: ${module.safetyBadge}` : "",
      module.note ? `운영 주의: ${module.note}` : "",
      module.historySupport
        ? "작업 이력 확인을 지원한다."
        : "이 기능은 별도 작업 이력이 없거나 제한적이다.",
      module.externalProject
        ? "OPS Center에서 독립 운영 모듈 또는 외부 엔진을 연결해 연다."
        : "OPS Center 내부 기능이다.",
    ]
      .filter(Boolean)
      .join("\n"),
    source: "extended-module-registry",
    version,
  }));

  return [
    ...STATIC_OPS_AI_KNOWLEDGE.map((section) => ({
      ...section,
      version: section.version === "1" ? version : section.version,
    })),
    ...moduleSections,
  ];
}

function resolveSources(
  sourceIds: unknown,
  selected: readonly OpsAiKnowledgeSection[],
) {
  const requested = new Set(uniqueTextArray(sourceIds, 6, 160));
  const matched = selected.filter((section) => requested.has(section.id));
  const fallback = matched.length ? matched : selected.slice(0, 3);
  return fallback.map((section) => ({
    id: section.id,
    title: section.title,
    route: section.route,
    version: section.version,
  }));
}

function outOfScopeResult(): OpsAiHelpResult {
  return {
    status: "out_of_scope",
    answer:
      "이 상담원은 현재 Commerce OS 기능의 사용법과 오류 확인만 안내합니다. 신규 개발, 코드 수정, 배포, 데이터 변경 또는 실제 주문·결제·가격변경 실행은 처리하지 않습니다.",
    steps: [],
    warnings: ["실제 작업이 필요하면 관리자용 개발 대화에서 별도로 요청하세요."],
    sources: [],
    cached: true,
  };
}

function extractOutputText(payload: OpenAiPayload) {
  const direct = limitedText(payload.output_text, 20_000);
  if (direct) return direct;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text") {
        const candidate = limitedText(content.text, 20_000);
        if (candidate) return candidate;
      }
    }
  }
  return "";
}

function responseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["status", "answer", "steps", "warnings", "source_ids"],
    properties: {
      status: {
        type: "string",
        enum: ["answered", "insufficient_evidence"],
      },
      answer: { type: "string", minLength: 1, maxLength: 2_000 },
      steps: {
        type: "array",
        maxItems: 6,
        items: { type: "string", minLength: 1, maxLength: 300 },
      },
      warnings: {
        type: "array",
        maxItems: 4,
        items: { type: "string", minLength: 1, maxLength: 300 },
      },
      source_ids: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: { type: "string", minLength: 1, maxLength: 160 },
      },
    },
  };
}

function systemPrompt() {
  return [
    "당신은 Commerce OS OPS Center 내부의 읽기 전용 AI 사용상담원이다.",
    "오직 이미 존재하는 기능의 위치, 입력값, 사용 순서, 버튼과 상태의 의미, 오류 확인법, 실행 전 주의사항만 설명한다.",
    "신규 기능 개발, 코드 작성·수정, GitHub·PR·배포, 환경변수 변경, DB 쓰기, 샵플링 쓰기, 1688 주문·결제, 가격·재고 변경을 수행하거나 수행 방법을 설계하지 않는다.",
    "제공된 근거에 없는 기능이나 동작을 추측하지 않는다. 근거가 부족하면 status를 insufficient_evidence로 하고 필요한 화면명 또는 오류 문구만 요청한다.",
    "사용자에게 버튼을 누르라고 안내할 때 실제 외부 데이터가 변경되는지, 미리보기인지, 되돌릴 수 있는지 근거에 나온 범위에서 명확히 구분한다.",
    "답변은 한국어로 짧고 구체적으로 작성한다. 먼저 결론을 말하고 필요한 경우에만 단계와 경고를 제공한다.",
    "source_ids에는 반드시 제공된 knowledge의 id만 넣는다.",
  ].join("\n");
}

function userPrompt(
  input: OpsAiHelpInput,
  selected: readonly OpsAiKnowledgeSection[],
) {
  return JSON.stringify(
    {
      task: "현재 화면과 운영 근거를 사용해 기능 사용법만 안내",
      current_page: input.page,
      recent_conversation: input.history,
      question: input.question,
      knowledge: selected.map((section) => ({
        id: section.id,
        title: section.title,
        route: section.route,
        source: section.source,
        version: section.version,
        content: section.content,
      })),
    },
    null,
    2,
  );
}

function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function configuredCacheTtl() {
  const value = Number(process.env.OPS_AI_HELP_CACHE_TTL_MS);
  return Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : DEFAULT_CACHE_TTL_MS;
}

function cacheKey(
  model: string,
  input: OpsAiHelpInput,
  selected: readonly OpsAiKnowledgeSection[],
) {
  return JSON.stringify({
    model,
    question: input.question.toLocaleLowerCase("ko-KR"),
    pathname: input.page.pathname,
    title: input.page.title,
    versions: selected.map((section) => `${section.id}@${section.version}`),
  });
}

function readCache(key: string, now: number) {
  const entry = answerCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    answerCache.delete(key);
    return null;
  }
  return { ...entry.result, cached: true } satisfies OpsAiHelpResult;
}

function writeCache(
  key: string,
  result: Omit<OpsAiHelpResult, "cached">,
  now: number,
) {
  if (answerCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = answerCache.keys().next().value;
    if (typeof oldestKey === "string") answerCache.delete(oldestKey);
  }
  answerCache.set(key, { expiresAt: now + configuredCacheTtl(), result });
}

export async function answerOpsAiHelpQuestion(
  inputValue: unknown,
  options: {
    fetcher?: OpenAiFetch;
    apiKey?: string;
    model?: string;
    timeoutMs?: number;
    now?: number;
  } = {},
): Promise<OpsAiHelpResult> {
  const input = parseOpsAiHelpInput(inputValue);
  if (isOpsHelpActionRequest(input.question)) return outOfScopeResult();

  const sections = buildOpsAiKnowledgeSections();
  const selected = selectOpsAiKnowledge(input.question, input.page, sections, 7);
  if (!selected.length) {
    return {
      status: "insufficient_evidence",
      answer:
        "현재 질문과 연결되는 운영 근거를 찾지 못했습니다. 보고 있는 화면 이름과 오류 문구 또는 눌렀던 버튼명을 알려주세요.",
      steps: [],
      warnings: ["근거가 없는 상태에서는 기능 동작을 추측하지 않습니다."],
      sources: [],
      cached: true,
    };
  }

  const apiKey =
    options.apiKey ?? process.env.OPS_AI_HELP_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error("OPS_AI_HELP_OPENAI_API_KEY 또는 OPENAI_API_KEY 설정이 필요합니다.");
  }
  const model =
    limitedText(
      options.model ??
        process.env.OPS_AI_HELP_MODEL ??
        process.env.OPENAI_MODEL ??
        "gpt-5-mini",
      100,
    ) || "gpt-5-mini";
  const now = options.now ?? Date.now();
  const key = cacheKey(model, input, selected);
  const cached = readCache(key, now);
  if (cached) return cached;

  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 45_000,
  );

  let response: Response;
  try {
    response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: systemPrompt(),
        input: userPrompt(input, selected),
        max_output_tokens: 900,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "ops_ai_help_answer",
            strict: true,
            schema: responseSchema(),
          },
        },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const payload = (await response.json().catch(() => ({}))) as OpenAiPayload;
  if (!response.ok) {
    throw new Error(
      limitedText(payload.error?.message, 500) ||
        `OpenAI 사용상담 요청에 실패했습니다. (${response.status})`,
    );
  }
  const outputText = extractOutputText(payload);
  if (!outputText) throw new Error("AI 사용상담 답변이 비어 있습니다.");

  let raw: RawModelAnswer;
  try {
    raw = JSON.parse(outputText) as RawModelAnswer;
  } catch {
    throw new Error("AI 사용상담 답변 형식을 읽을 수 없습니다.");
  }

  const status =
    raw.status === "insufficient_evidence"
      ? "insufficient_evidence"
      : "answered";
  const result: Omit<OpsAiHelpResult, "cached"> = {
    status,
    answer:
      limitedText(raw.answer, 2_000) ||
      "현재 근거만으로는 정확한 사용법을 설명하기 어렵습니다.",
    steps: uniqueTextArray(raw.steps, 6, 300),
    warnings: uniqueTextArray(raw.warnings, 4, 300),
    sources: resolveSources(raw.source_ids, selected),
    usage: {
      inputTokens: numberOrZero(payload.usage?.input_tokens),
      outputTokens: numberOrZero(payload.usage?.output_tokens),
      totalTokens: numberOrZero(payload.usage?.total_tokens),
    },
  };
  writeCache(key, result, now);
  return { ...result, cached: false };
}

export function resetOpsAiHelpCacheForTests() {
  answerCache.clear();
}
