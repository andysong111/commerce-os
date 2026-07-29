import { NextResponse } from "next/server";
import { fetchShoplingPriceAdjustmentCanaryResult } from "@/lib/shoplingPriceAdjustmentCanaryRunner";
import { requireShoplingPriceAdjustmentOperator } from "@/lib/shoplingPriceAdjustmentAuth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireShoplingPriceAdjustmentOperator(request);
  if (!auth.ok) return auth.response;
  const requestId = new URL(request.url).searchParams.get("request_id")?.trim() ?? "";
  const result = await fetchShoplingPriceAdjustmentCanaryResult(requestId);
  return NextResponse.json(result, { status: result.status === "error" ? 400 : 200 });
}
