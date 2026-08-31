import { runInternalChinaCostPriceProposalStep } from "@/lib/internalChinaCostPriceReview";
import { runInternalChinaGroupCostPriceProposalStep } from "@/lib/internalChinaGroupCostPriceReview";
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
    const costSnapshot = await runInternalChinaCostPriceProposalStep();
    const groupAware = await runInternalChinaGroupCostPriceProposalStep();
    if (groupAware.processed || costSnapshot.processed) {
      return Response.json(
        {
          ok: true,
          flow: "internal_china_group_cost_price_v2",
          costSnapshot,
          groupAware,
          productGradeUsed: false,
          productGroupGuessingEnabled: false,
          shoplingProductGroupWritesEnabled: false,
          shoplingPriceWritesEnabled: false,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const legacy = await runReceiptLivePriceProposalStep();
    return Response.json(
      {
        ok: true,
        flow: "legacy_receipt_live_price",
        ...legacy,
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
            : "입고확정 가격제안 Worker 실행에 실패했습니다.",
        writesEnabled: false,
        productGradeUsed: false,
        shoplingProductGroupWritesEnabled: false,
        shoplingPriceWritesEnabled: false,
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
