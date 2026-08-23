import { redactReliabilityText } from "@/lib/reliability/reliabilityEvent";
import {
  buildReliabilityLearningPrompt,
  isReliabilityOpenAiOutputLimitIncomplete,
  parseReliabilityLearningAnalysis,
  reliabilityLearningAnalysisSchema,
  reliabilityLearningSystemPrompt,
  type OpenAiResponsePayload,
  type ReliabilityLearningAnalysis,
  type ReliabilityLearningAnalysisJob,
} from "@/lib/reliability/reliabilityLearningPolicy";

type OpenAiPayload = OpenAiResponsePayload & {
  error?: { message?: unknown };
  status?: unknown;
  incomplete_details?: { reason?: unknown };
};

const OPENAI_TIMEOUT_MS = 46_000;
const INITIAL_OUTPUT_TOKEN_BUDGET = 3_600;
const RETRY_OUTPUT_TOKEN_BUDGET = 8_000;

export type ReliabilityOpenAiConfiguration = {
  apiKey: string;
  model: string;
};

export type ReliabilityStructuredJsonRequest = {
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  initialOutputTokens?: number;
  retryOutputTokens?: number;
};

export function reliabilityOpenAiConfiguration(): ReliabilityOpenAiConfiguration | null {
  const apiKey = String(process.env.RELIABILITY_OPENAI_API_KEY ?? "").trim();
  const model = String(process.env.RELIABILITY_OPENAI_MODEL ?? "gpt-5-mini")
    .trim()
    .slice(0, 120);
  if (!apiKey || !model) return null;
  return { apiKey, model };
}

function outputTokenBudget(attempt: number) {
  return attempt <= 0 ? INITIAL_OUTPUT_TOKEN_BUDGET : RETRY_OUTPUT_TOKEN_BUDGET;
}

async function requestOnce(
  job: ReliabilityLearningAnalysisJob,
  config: ReliabilityOpenAiConfiguration,
  maxOutputTokens: number,
): Promise<OpenAiPayload> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      instructions: reliabilityLearningSystemPrompt(),
      input: buildReliabilityLearningPrompt(job),
      max_output_tokens: maxOutputTokens,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "commerce_os_reliability_learning_analysis",
          strict: true,
          schema: reliabilityLearningAnalysisSchema(),
        },
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
  });

  const payload = (await response.json().catch(() => ({}))) as OpenAiPayload;
  if (!response.ok) {
    const message = payload.error?.message
      ? redactReliabilityText(payload.error.message, 500)
      : `status=${response.status}`;
    throw new Error(`OpenAI 신뢰성 분석 요청에 실패했습니다: ${message}`);
  }
  return payload;
}

function responseOutputText(payload: OpenAiPayload) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown }).content)
      ? ((item as { content: unknown[] }).content ?? [])
      : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) return text.trim();
    }
  }
  return "";
}

function structuredResponseIncomplete(payload: OpenAiPayload) {
  const reason = String(payload.incomplete_details?.reason ?? "");
  return payload.status === "incomplete" && reason === "max_output_tokens";
}

async function requestStructuredOnce(
  request: ReliabilityStructuredJsonRequest,
  config: ReliabilityOpenAiConfiguration,
  maxOutputTokens: number,
) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      instructions: request.instructions,
      input: request.input,
      max_output_tokens: maxOutputTokens,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: request.schemaName.slice(0, 64),
          strict: true,
          schema: request.schema,
        },
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as OpenAiPayload;
  if (!response.ok) {
    const message = payload.error?.message
      ? redactReliabilityText(payload.error.message, 500)
      : `status=${response.status}`;
    throw new Error(`OpenAI 자동개선 계획 요청에 실패했습니다: ${message}`);
  }
  return payload;
}

export async function requestReliabilityStructuredJson<T>(
  request: ReliabilityStructuredJsonRequest,
  config: ReliabilityOpenAiConfiguration,
): Promise<T> {
  const budgets = [
    Math.max(1_000, Math.min(12_000, request.initialOutputTokens ?? 6_000)),
    Math.max(2_000, Math.min(16_000, request.retryOutputTokens ?? 12_000)),
  ];
  for (let attempt = 0; attempt < budgets.length; attempt += 1) {
    const payload = await requestStructuredOnce(request, config, budgets[attempt]);
    if (attempt === 0 && structuredResponseIncomplete(payload)) continue;
    const text = responseOutputText(payload);
    if (!text) throw new Error("OpenAI 자동개선 계획 응답이 비어 있습니다.");
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error("OpenAI 자동개선 계획 JSON을 읽지 못했습니다.");
    }
  }
  throw new Error("OpenAI 자동개선 계획 재시도 후에도 응답을 완성하지 못했습니다.");
}

export async function requestReliabilityOpenAiAnalysis(
  job: ReliabilityLearningAnalysisJob,
  config: ReliabilityOpenAiConfiguration,
): Promise<ReliabilityLearningAnalysis> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const payload = await requestOnce(job, config, outputTokenBudget(attempt));
    if (attempt === 0 && isReliabilityOpenAiOutputLimitIncomplete(payload)) {
      continue;
    }
    return parseReliabilityLearningAnalysis(payload, job.risk_level);
  }
  throw new Error("OpenAI 신뢰성 분석 재시도 후에도 응답을 완성하지 못했습니다.");
}
