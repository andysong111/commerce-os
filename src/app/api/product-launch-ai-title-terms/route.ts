import { NextResponse } from "next/server";
import { generateProductLaunchAiTitleTerms } from "@/lib/productLaunchAiTitleTerms";
import {
  consumeProductLaunchAiTitleTermsRateLimit,
  requireProductLaunchAiTitleTermsOperator,
} from "@/lib/productLaunchAiTitleTermsAuth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireProductLaunchAiTitleTermsOperator();
  if (auth.response) return auth.response;

  const rateLimit = consumeProductLaunchAiTitleTermsRateLimit(
    auth.operator.userId,
  );
  if (!rateLimit.ok) {
    return NextResponse.json(
      {
        status: "error",
        message:
          "AI 생성어 요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
        retry_after_seconds: rateLimit.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "요청 JSON을 읽을 수 없습니다." },
      { status: 400 },
    );
  }

  try {
    const result = await generateProductLaunchAiTitleTerms(body);
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "X-RateLimit-Remaining": String(rateLimit.remaining),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "AI 상품명 생성어를 만드는 중 오류가 발생했습니다.";
    const status = /OPENAI_API_KEY/.test(message) ? 503 : 400;
    return NextResponse.json(
      { status: "error", message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
