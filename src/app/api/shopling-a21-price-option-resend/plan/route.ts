import { loadInternalChinaBrowserMallPriceReadbackSummary } from "@/lib/internalChinaBrowserMallPriceReadback";
import {
  buildInternalChinaDirectTargetExecutionPlan,
  loadInternalChinaDirectTargetExecution,
} from "@/lib/internalChinaGroupCostPriceExecution";
import { loadLatestInternalChinaGroupCostPriceProposal } from "@/lib/internalChinaGroupCostPriceReview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function GET() {
  try {
    const latest = await loadLatestInternalChinaGroupCostPriceProposal();
    const proposal = latest.proposal;
    if (!proposal) {
      return json({ ok: false, error: "A21_PRICE_RESEND_PROPOSAL_NOT_FOUND", message: "확정원가 가격조정 제안이 없습니다." }, 404);
    }

    const execution = await loadInternalChinaDirectTargetExecution(proposal.fingerprint);
    if (!execution?.shoplingWritesDispatched) {
      return json({ ok: false, error: "A21_PRICE_RESEND_SHOPLING_APPLY_REQUIRED", message: "먼저 Shopling 확정원가 목표가 적용이 완료되어야 합니다." }, 409);
    }

    const plan = buildInternalChinaDirectTargetExecutionPlan(proposal);
    if (execution.goodsKeyCount !== plan.goodsKeyCount) {
      return json({ ok: false, error: "A21_PRICE_RESEND_EXECUTION_SCOPE_MISMATCH", message: "가격 적용 범위와 현재 제안 범위가 일치하지 않습니다." }, 409);
    }

    const readback = await loadInternalChinaBrowserMallPriceReadbackSummary(proposal.fingerprint);
    const fullyVerified =
      readback.state === "VERIFIED" &&
      readback.verifiedGoodsKeyCount === plan.goodsKeyCount &&
      readback.failedGoodsKeyCount === 0 &&
      readback.mallMismatchCount === 0 &&
      readback.mallMissingCount === 0 &&
      readback.mallCheckCount > 0 &&
      readback.mallMatchCount === readback.mallCheckCount;

    if (!fullyVerified) {
      return json(
        {
          ok: false,
          error: "A21_PRICE_RESEND_READBACK_NOT_VERIFIED",
          message: "Shopling 저장 가격 재조회가 100% 일치하지 않아 마켓 수정전송 대상을 내려주지 않습니다.",
          readback,
        },
        409,
      );
    }

    return json({
      ok: true,
      bridge: "shopling-a21-price-option-resend-v1",
      proposalFingerprint: proposal.fingerprint,
      executionPolicy: plan.executionPolicy,
      goodsKeyCount: plan.goodsKeyCount,
      rows: plan.rows.map((row) => ({
        goodsKey: row.goodsKey,
        productGroup: row.productGroup,
        mallTargetCount: row.mallTargets.length,
      })),
      readback,
      transmission: {
        sourcePrice: "SHOPPING_MALL_SPECIFIC_SELL_PRICE",
        priceMode: "PRICE_ONLY",
        optionMode: "OPTION_ONLY",
        maxSearchGoodsKeys: 200,
        maxVisibleRows: 500,
        maxParallelWindows: 4,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "A21 price resend plan failed");
    return json({ ok: false, error: message.split(":", 1)[0], message }, 500);
  }
}
