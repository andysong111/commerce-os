import { runReceiptLivePriceCanaryPreflightStep } from "@/lib/receiptLivePriceCanaryPreflight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.trim();
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { ok: false, code: "UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const result = await runReceiptLivePriceCanaryPreflightStep();
    return Response.json(
      {
        ok: true,
        ...result,
        actualShoplingPriceWrites: 0,
        canaryWritesEnabled: false,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "RECEIPT_LIVE_PRICE_CANARY_PREFLIGHT_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "입고확정 가격 canary 사전검증에 실패했습니다.",
        actualShoplingPriceWrites: 0,
        canaryWritesEnabled: false,
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
