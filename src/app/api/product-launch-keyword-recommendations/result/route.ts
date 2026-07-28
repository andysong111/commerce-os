import { NextResponse } from "next/server";
import { fetchKeywordRecommendationResult } from "@/lib/productLaunchKeywordRecommendationRunner";
import { sanitizeNoSpaceRecommendationResult } from "@/lib/productLaunchNoSpaceKeywordPolicy";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const requestId = params.get("request_id")?.trim() ?? "";
  const goodsKeys = params.get("goods_keys")?.trim() ?? "";
  const result = sanitizeNoSpaceRecommendationResult(
    await fetchKeywordRecommendationResult(requestId, goodsKeys),
  );
  return NextResponse.json(result, {
    status: result.status === "error" ? 400 : 200,
  });
}
