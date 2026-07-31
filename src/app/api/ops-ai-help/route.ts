import { NextResponse } from "next/server";
import { answerOpsAiHelpQuestion } from "@/lib/opsAiHelp";
import {
  consumeOpsAiHelpRateLimit,
  requireOpsAiHelpOperator,
} from "@/lib/opsAiHelpAuth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireOpsAiHelpOperator(request);
  if (auth.response) return auth.response;

  const rateLimit = consumeOpsAiHelpRateLimit(request, auth.operator);
  if (!rateLimit.ok) {
    return NextResponse.json(
      {
        status: "error",
        message: "AI 사용상담 질문이 너무 많습니다. 잠시 후 다시 시도하세요.",
        retry_after_seconds: rateLimit.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "질문 요청을 읽을 수 없습니다." },
      { status: 400 },
    );
  }

  try {
    const result = await answerOpsAiHelpQuestion(body);
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "X-RateLimit-Remaining": String(rateLimit.remaining),
        "X-Ops-AI-Cache": result.cached ? "HIT" : "MISS",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "AI 사용상담 답변을 만드는 중 오류가 발생했습니다.";
    const status = /OPENAI_API_KEY/.test(message) ? 503 : 400;
    return NextResponse.json(
      { status: "error", message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
