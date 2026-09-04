import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import {
  finalizePurchaseRecommendationV2,
  loadFinalizedPurchaseRecommendationV2,
} from "@/lib/purchaseRecommendationFinalization";
import { seoulCalendarMonth } from "@/lib/monthlyPurchasePolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "PURCHASE_V2_FINALIZE_UNAUTHORIZED",
      message: "발주 V2 예산확정 권한이 필요합니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const url = new URL(request.url);
    const cycleMonth =
      url.searchParams.get("cycleMonth") || seoulCalendarMonth(new Date());
    const snapshot = await loadFinalizedPurchaseRecommendationV2(cycleMonth);
    return Response.json(
      { ok: true, snapshot },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PURCHASE_V2_FINALIZED_READ_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "확정 발주안을 읽지 못했습니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const body = (await request.json()) as { cashKrw?: unknown };
    const result = await finalizePurchaseRecommendationV2(body.cashKrw);
    return Response.json(
      {
        ok: true,
        duplicate: result.duplicate,
        snapshot: result.snapshot,
        message: result.duplicate
          ? "동일한 입력과 원장 기준으로 이미 확정된 발주안입니다. 기존 스냅샷을 사용합니다."
          : "주문일 기준 발주 V2 권장안과 현금예산을 불변 스냅샷으로 확정했습니다.",
      },
      {
        status: result.duplicate ? 200 : 201,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "발주 V2 예산확정에 실패했습니다.";
    return Response.json(
      {
        ok: false,
        code: message.startsWith("PURCHASE_V2_FINALIZE_BLOCKED")
          ? "PURCHASE_V2_FINALIZE_BLOCKED"
          : "PURCHASE_V2_FINALIZE_FAILED",
        message,
      },
      { status: 409, headers: { "cache-control": "no-store" } },
    );
  }
}
