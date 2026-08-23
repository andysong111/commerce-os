import { redactReliabilityText } from "@/lib/reliability/reliabilityEvent";
import {
  buildReliabilityLearningPrompt,
  parseReliabilityLearningAnalysis,
  reliabilityLearningAnalysisSchema,
  reliabilityLearningSystemPrompt,
  type ReliabilityLearningAnalysis,
  type ReliabilityLearningAnalysisJob,
} from "@/lib/reliability/reliabilityLearningPolicy";

type OpenAiPayload = Parameters<typeof parseReliabilityLearningAnalysis>[0] & {
  error?: { message?: unknown };
};

const OPENAI_TIMEOUT_MS = 42_000;

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

export async function requestReliabilityOpenAiAnalysis(
  job: ReliabilityLearningAnalysisJob,
  config: ReliabilityOpenAiConfiguration,
): Promise<ReliabilityLearningAnalysis> {
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
      max_output_tokens: 1_800,
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
  return parseReliabilityLearningAnalysis(payload, job.risk_level);
}
