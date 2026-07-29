import { NextResponse } from "next/server";
import { dispatchShoplingPriceAdjustmentPlan } from "@/lib/shoplingPriceAdjustmentPlanRunner";
import { requireShoplingPriceAdjustmentOperator } from "@/lib/shoplingPriceAdjustmentAuth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireShoplingPriceAdjustmentOperator(request);
  if (!auth.ok) return auth.response;
  let body: { rows?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "error", message: "요청 JSON을 읽을 수 없습니다." }, { status: 400 });
  }
  const result = await dispatchShoplingPriceAdjustmentPlan(body.rows);
  return NextResponse.json(result, { status: result.status === "success" ? 200 : 400 });
}
