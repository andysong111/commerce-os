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
};

const OPENAI_TIMEOUT_MS = 46_000;
const INITIAL_OUTPUT_TOKEN_BUDGET = 3_600;
const RETRY_OUTPUT_TOKEN_BUDGET = 8_000;

export type ReliabilityOpenAiConfiguration = {
  apiKey: string;
  model: string;
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
