import {
  loadLatestPurchaseRecommendationFinalization,
  savePurchaseRecommendationFinalization,
} from "@/lib/purchaseRecommendationFinalization";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { seoulCalendarMonth } from "@/lib/monthlyPurchasePolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "PURCHASE_FINALIZATION_UNAUTHORIZED",
      message: "발주 예산과 권장안을 확정할 권한이 필요합니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const url = new URL(request.url);
  const cycleMonth =
    url.searchParams.get("cycleMonth") || seoulCalendarMonth(new Date());
  try {
    const snapshot = await loadLatestPurchaseRecommendationFinalization(
      cycleMonth,
    );
    return Response.json(
      {
        ok: true,
        cycleMonth,
        snapshot,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PURCHASE_FINALIZATION_READ_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "확정 발주안을 읽지 못했습니다.",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const stored = await savePurchaseRecommendationFinalization(body);
    return Response.json(
      {
        ok: true,
        duplicate: stored.duplicate,
        snapshot: stored.snapshot,
        message: stored.duplicate
          ? "이미 확정한 동일 발주안이라 중복 저장하지 않았습니다."
          : "예산과 V2 발주권장안을 확정했습니다. 이제 1688 주문·발주마감 화면에서 같은 스냅샷을 조회할 수 있습니다.",
      },
      {
        status: stored.duplicate ? 200 : 201,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PURCHASE_FINALIZATION_STORE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "발주 예산 확정에 실패했습니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
