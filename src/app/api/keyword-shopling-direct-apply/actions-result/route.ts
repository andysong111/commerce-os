import { NextResponse } from "next/server";
import {
  fetchKeywordShoplingDirectApplyResult,
  isValidKeywordShoplingDirectApplyRequestId,
} from "@/lib/keywordShoplingDirectApplyRunner";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId =
    new URL(request.url).searchParams.get("request_id")?.trim() ?? "";
  if (!requestId || !isValidKeywordShoplingDirectApplyRequestId(requestId))
    return NextResponse.json(
      {
        status: "error",
        phase: "unknown",
        requestId,
        message: "요청 추적 ID 형식이 올바르지 않습니다.",
      },
      { status: 400 },
    );
  const result = await fetchKeywordShoplingDirectApplyResult(requestId);
  return NextResponse.json(result, {
    status: result.status === "error" ? 400 : 200,
  });
}
