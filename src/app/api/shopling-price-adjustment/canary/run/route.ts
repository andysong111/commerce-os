import { NextResponse } from "next/server";
import { dispatchShoplingPriceAdjustmentCanary } from "@/lib/shoplingPriceAdjustmentCanaryRunner";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { input?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ status: "error", message: "요청 JSON을 읽을 수 없습니다." }, { status: 400 }); }
  const result = await dispatchShoplingPriceAdjustmentCanary(body.input);
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
