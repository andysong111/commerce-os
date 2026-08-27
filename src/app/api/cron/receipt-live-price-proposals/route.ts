import { after } from "next/server";
import { runReceiptLivePriceProposalStep } from "@/lib/receiptLivePriceProposalWorker";
import { processSeoRunQueue } from "@/lib/seoRunWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.trim();
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

function scheduleDurableSeoRunRecovery() {
  after(async () => {
    try {
      const result = await processSeoRunQueue({
        workerId: `seo-run-shared-receipt-cron-${Date.now()}`,
        maxJobs: 2,
        timeBudgetMs: 220_000,
      });
      console.info("[receipt-live-price-proposals] durable SEO RUN recovery", result);
    } catch (error) {
      console.error("[receipt-live-price-proposals] durable SEO RUN recovery failed", error);
    }
  });
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { ok: false, code: "UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  // Reuse this already-staggered 5-minute cron wakeup instead of adding a new
  // high-frequency Supabase worker. The enqueue API still starts work immediately;
  // this background task only resumes interrupted durable checkpoints.
  scheduleDurableSeoRunRecovery();

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
