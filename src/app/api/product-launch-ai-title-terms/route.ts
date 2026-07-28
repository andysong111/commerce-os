import { NextResponse } from "next/server";
import { generateProductLaunchAiTitleTerms } from "@/lib/productLaunchAiTitleTerms";

export const runtime = "nodejs";

export async function POST(request: Request) {
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
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "AI 상품명 생성어를 만드는 중 오류가 발생했습니다.";
    const status = /OPENAI_API_KEY/.test(message) ? 503 : 400;
    return NextResponse.json({ status: "error", message }, { status });
  }
}
