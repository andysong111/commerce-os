export type OpenAiResponsesPayload = {
  status?: unknown;
  incomplete_details?: { reason?: unknown };
  output_text?: unknown;
  output?: Array<{
    content?: Array<{ type?: unknown; text?: unknown }>;
  }>;
  error?: { message?: unknown };
};

export class OpenAiStructuredOutputIncompleteError extends Error {
  readonly code = "OPENAI_STRUCTURED_OUTPUT_INCOMPLETE";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OpenAiStructuredOutputIncompleteError";
  }
}

function rawText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function extractOpenAiStructuredOutputText(
  payload: OpenAiResponsesPayload,
) {
  const direct = rawText(payload.output_text);
  if (direct) return direct;

  const parts: string[] = [];
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type !== "output_text") continue;
      const value = rawText(content.text);
      if (value) parts.push(value);
    }
  }
  return parts.join("").trim();
}

export function parseOpenAiStructuredOutput(
  payload: OpenAiResponsesPayload,
): { results?: unknown } {
  const status = rawText(payload.status);
  const incompleteReason = rawText(payload.incomplete_details?.reason);
  if (status === "incomplete" || incompleteReason) {
    throw new OpenAiStructuredOutputIncompleteError(
      incompleteReason === "max_output_tokens"
        ? "AI 응답이 출력 한도에서 중간에 잘렸습니다."
        : `AI 응답이 완성되지 않았습니다${incompleteReason ? `: ${incompleteReason}` : "."}`,
    );
  }

  const outputText = extractOpenAiStructuredOutputText(payload);
  if (!outputText) {
    throw new OpenAiStructuredOutputIncompleteError(
      "AI 카테고리 응답이 비어 있습니다.",
    );
  }

  try {
    return JSON.parse(outputText) as { results?: unknown };
  } catch (error) {
    throw new OpenAiStructuredOutputIncompleteError(
      "AI 응답 JSON이 중간에서 잘렸거나 완성되지 않았습니다.",
      { cause: error },
    );
  }
}

export function isOpenAiStructuredOutputIncompleteError(error: unknown) {
  return (
    error instanceof OpenAiStructuredOutputIncompleteError ||
    (error instanceof Error &&
      "code" in error &&
      error.code === "OPENAI_STRUCTURED_OUTPUT_INCOMPLETE")
  );
}

export function recommendationOutputTokenBudget(
  itemCount: number,
  attempt = 0,
) {
  const normalizedCount = Math.max(1, Math.min(25, Math.trunc(itemCount) || 1));
  const initial = Math.min(24_000, 1_800 + normalizedCount * 1_200);
  if (attempt <= 0) return Math.max(3_600, initial);
  return Math.min(32_000, Math.max(8_000, initial * 2));
}
