import { NextResponse } from "next/server";
import { enqueuePurchasePlanDraft } from "@/lib/purchasePlanDraftQueue";

const INTEGRATION_HEADER = "x-commerce-os-integration-secret";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = authorize(request, [
    process.env.PRODUCT_DECISION_TO_CHINA_ORDER_SECRET,
    process.env.PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET,
    process.env.CHINA_ORDER_MANAGER_INTEGRATION_SECRET,
    process.env.SYNC_JOB_SECRET,
  ]);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  try {
    const payload = await request.json().catch(() => ({}));
    const result = await enqueuePurchasePlanDraft(payload);
    return NextResponse.json({
      ok: true,
      queued: !result.alreadyImported,
      alreadyQueued: result.alreadyQueued,
      alreadyImported: result.alreadyImported,
      sourceRunId: result.entry.sourceRunId,
      saved: result.entry.items.length,
      status: result.entry.status,
      batchId: result.entry.batchId,
      orderManagerUrl: "https://china-order-manager.andy123df23.chatgpt.site",
      message: result.alreadyImported
        ? "이미 중국 발주차시로 반영된 발주안입니다."
        : result.alreadyQueued
          ? "중국 주문초안 전달 대기열에 이미 저장되어 있습니다."
          : "중국 주문초안 전달 대기열에 안전하게 저장했습니다.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "PURCHASE_DRAFT_RELAY_PUSH_FAILED",
        message: error instanceof Error ? error.message : "발주안 중계 저장에 실패했습니다.",
      },
      { status: 400 },
    );
  }
}

function authorize(request: Request, candidates: Array<string | undefined>) {
  const expected = candidates.map((value) => value?.trim()).filter(Boolean) as string[];
  if (!expected.length) {
    return {
      ok: false as const,
      status: 503,
      body: {
        ok: false,
        code: "PURCHASE_DRAFT_RELAY_SECRET_REQUIRED",
        message: "발주추천 중계 인증값이 설정되지 않았습니다.",
      },
    };
  }
  const supplied = request.headers.get(INTEGRATION_HEADER)?.trim() ?? "";
  if (!supplied || !expected.includes(supplied)) {
    return {
      ok: false as const,
      status: 401,
      body: {
        ok: false,
        code: "INVALID_PURCHASE_DRAFT_RELAY_SECRET",
        message: "발주추천 중계 인증에 실패했습니다.",
      },
    };
  }
  return { ok: true as const };
}
