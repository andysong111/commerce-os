import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { loadPurchaseRecommendationV2 } from "@/lib/purchaseRecommendationV2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "PURCHASE_V2_UNAUTHORIZED",
      message: "Commerce OS 발주 V2를 조회할 권한이 필요합니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const url = new URL(request.url);
  const cash = url.searchParams.get("cashKrw");
  const report = await loadPurchaseRecommendationV2({
    cashKrw: cash === null ? undefined : cash,
  });
  return Response.json(
    { ok: report.state === "READY", report },
    {
      status: report.state === "READY" ? 200 : 409,
      headers: { "cache-control": "no-store" },
    },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const body = (await request.json()) as { cashKrw?: unknown };
    const report = await loadPurchaseRecommendationV2({
      cashKrw: body.cashKrw,
    });
    return Response.json(
      { ok: report.state === "READY", report },
      {
        status: report.state === "READY" ? 200 : 409,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PURCHASE_V2_PREVIEW_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "발주 V2 권장안을 계산하지 못했습니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
