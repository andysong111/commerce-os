import { NextRequest, NextResponse } from "next/server";
import { fetchShoplingPriceAdjustmentBatchCanaryResult } from "@/lib/shoplingPriceAdjustmentBatchCanaryRunner";

export async function GET(request: NextRequest) {
  const requestId = request.nextUrl.searchParams.get("request_id")?.trim() ?? "";
  const result = await fetchShoplingPriceAdjustmentBatchCanaryResult(requestId);
  return NextResponse.json(result, { status: result.status === "error" ? 400 : 200 });
}
