import { redactReliabilityText } from "@/lib/reliability/reliabilityEvent";
import {
  buildReliabilityAutofixPrompt,
  normalizeAutofixContext,
  parseReliabilityAutofixProposal,
  reliabilityAutofixSchema,
  reliabilityAutofixSystemPrompt,
  type ReliabilityAutofixContextFile,
  type ReliabilityAutofixJob,
  type ReliabilityAutofixProposal,
} from "@/lib/reliability/reliabilityAutofixPolicy";
import { reliabilityOpenAiConfiguration } from "@/lib/reliability/reliabilityOpenAiClient";

const AUTOFIX_TIMEOUT_MS = 145_000;
const AUTOFIX_OUTPUT_TOKENS = 9_000;

type ResponsesPayload = {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }>;
  status?: unknown;
  incomplete_details?: { reason?: unknown };
  error?: { message?: unknown };
};

function outputText(payload: ResponsesPayload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const parts: string[] = [];
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type !== "output_text" || typeof content.text !== "string") continue;
      parts.push(content.text);
    }
  }
  return parts.join("").trim();
}

export function reliabilityAutofixOpenAiConfigured() {
  return Boolean(reliabilityOpenAiConfiguration());
}

export async function requestReliabilityAutofixProposal(
  job: ReliabilityAutofixJob,
  rawFiles: ReliabilityAutofixContextFile[],
  revisionFeedback = "",
): Promise<ReliabilityAutofixProposal> {
  const base = reliabilityOpenAiConfiguration();
  if (!base) throw new Error("RELIABILITY_OPENAI_API_KEY가 설정되지 않았습니다.");
  const model = String(
    process.env.RELIABILITY_AUTOFIX_OPENAI_MODEL ??
      process.env.RELIABILITY_OPENAI_MODEL ??
      base.model,
  )
    .trim()
    .slice(0, 120);
  const files = normalizeAutofixContext(rawFiles);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${base.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: reliabilityAutofixSystemPrompt(),
      input: buildReliabilityAutofixPrompt(job, files, revisionFeedback),
      max_output_tokens: AUTOFIX_OUTPUT_TOKENS,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "commerce_os_reliability_autofix",
          strict: true,
          schema: reliabilityAutofixSchema(),
        },
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(AUTOFIX_TIMEOUT_MS),
  });

  const payload = (await response.json().catch(() => ({}))) as ResponsesPayload;
  if (!response.ok) {
    const message = payload.error?.message
      ? redactReliabilityText(payload.error.message, 600)
      : `status=${response.status}`;
    throw new Error(`OpenAI 자동수정 제안 요청 실패: ${message}`);
  }
  if (payload.status === "incomplete") {
    throw new Error(
      `OpenAI 자동수정 제안이 완성되지 않았습니다: ${String(
        payload.incomplete_details?.reason ?? "incomplete",
      ).slice(0, 200)}`,
    );
  }

  const raw = outputText(payload);
  if (!raw) throw new Error("OpenAI 자동수정 제안이 비어 있습니다.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("OpenAI 자동수정 JSON을 해석하지 못했습니다.", { cause: error });
  }
  return parseReliabilityAutofixProposal(parsed);
}