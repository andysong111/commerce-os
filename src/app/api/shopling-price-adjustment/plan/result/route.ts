import { NextResponse } from "next/server";
import { fetchShoplingPriceAdjustmentPlanResult } from "@/lib/shoplingPriceAdjustmentPlanRunner";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = new URL(request.url).searchParams.get("request_id")?.trim() ?? "";
  if (!requestId) return NextResponse.json({ status: "error", message: "요청 추적 ID가 필요합니다." }, { status: 400 });
  const result = await fetchShoplingPriceAdjustmentPlanResult(requestId);
  return NextResponse.json(result, { status: result.status === "error" ? 400 : 200 });
}
