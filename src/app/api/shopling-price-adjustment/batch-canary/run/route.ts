import { NextResponse } from "next/server";
import { dispatchShoplingPriceAdjustmentBatchCanary } from "@/lib/shoplingPriceAdjustmentBatchCanaryRunner";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { input?: unknown };
    const result = await dispatchShoplingPriceAdjustmentBatchCanary(body.input);
    return NextResponse.json(result, { status: result.status === "error" ? 400 : 200 });
  } catch (error) {
    return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : "10개 카나리 요청을 처리하지 못했습니다." }, { status: 400 });
  }
}
