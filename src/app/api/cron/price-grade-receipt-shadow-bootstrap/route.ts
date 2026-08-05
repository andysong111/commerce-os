import { runPriceGradeReceiptShadowBootstrap } from "@/lib/priceGradeReceiptShadowBootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization")?.trim();
  return Boolean(expected && authorization === `Bearer ${expected}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { ok: false, code: "UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    return Response.json(
      {
        ok: true,
        ...(await runPriceGradeReceiptShadowBootstrap()),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRICE_GRADE_RECEIPT_SHADOW_BOOTSTRAP_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "입고원가 보완 상품등급 그림자 비교를 완료하지 못했습니다.",
        writesEnabled: false,
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
