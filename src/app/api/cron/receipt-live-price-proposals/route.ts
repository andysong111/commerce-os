import { runReceiptLivePriceProposalStep } from "@/lib/receiptLivePriceProposalWorker";

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
    const result = await runReceiptLivePriceProposalStep();
    return Response.json(
      {
        ok: true,
        ...result,
        shoplingPriceWritesEnabled: false,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "RECEIPT_LIVE_PRICE_PROPOSAL_STEP_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "입고확정 LIVE 가격제안 Worker 실행에 실패했습니다.",
        writesEnabled: false,
        shoplingPriceWritesEnabled: false,
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
