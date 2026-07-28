import { NextResponse } from "next/server";
import { dispatchKeywordRecommendation } from "@/lib/productLaunchKeywordRecommendationRunner";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { goods_keys?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", phase: "failed", message: "요청 JSON을 읽을 수 없습니다." },
      { status: 400 },
    );
  }
  try {
    const result = await dispatchKeywordRecommendation(body);
    return NextResponse.json(result, {
      status: result.status === "queued" ? 200 : 400,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        phase: "failed",
        message:
          error instanceof Error
            ? error.message
            : "키워드 추천 실행 요청 중 오류가 발생했습니다.",
      },
      { status: 400 },
    );
  }
}
