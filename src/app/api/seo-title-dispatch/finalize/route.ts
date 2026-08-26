import { NextRequest } from "next/server";
import {
  callSeoTitleRpc,
  patchSeoTitleDispatch,
  patchSeoTitleDispatchItems,
  requireSeoTitleLedgerContext,
} from "@/lib/seoTitleLedgerServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: NextRequest) {
  const authenticated = await requireSeoTitleLedgerContext(request);
  if (!authenticated.ok) return authenticated.response;
  const context = authenticated.value;
  const input = record(await request.json().catch(() => ({})));

  const reservationId = text(input.reservationId);
  const dispatchId = text(input.dispatchId);
  const success = input.success === true;
  if (!reservationId || !dispatchId) {
    return Response.json(
      {
        ok: false,
        code: "SEO_TITLE_FINALIZE_IDS_REQUIRED",
        message: "상품명 재고 예약 ID와 출고 ID가 필요합니다.",
      },
      { status: 400 },
    );
  }

  try {
    const affected = await callSeoTitleRpc<number>(
      context,
      "finalize_seo_title_reservation",
      {
        p_owner_id: context.identity.userId,
        p_reservation_id: reservationId,
        p_dispatch_id: dispatchId,
        p_success: success,
      },
    );
    const completedAt = new Date().toISOString();
    await Promise.all([
      patchSeoTitleDispatch(context, dispatchId, {
        status: success ? "success" : "failed",
        result_payload: {
          ...record(input.resultPayload),
          finalizedBy: "seo-bulk-reregister",
          inventoryConsumed: success,
        },
        external_request_id: text(input.externalRequestId),
        completed_at: completedAt,
        updated_at: completedAt,
      }),
      patchSeoTitleDispatchItems(context, dispatchId, {
        status: success ? "success" : "failed",
        error_message: success ? "" : text(input.errorMessage),
        updated_at: completedAt,
      }),
    ]);

    return Response.json({
      ok: true,
      success,
      affected: Number(affected) || 0,
      dispatchId,
      reservationId,
      completedAt,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SEO_TITLE_FINALIZE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "상품명 재고 출고를 마감하지 못했습니다.",
      },
      { status: 400 },
    );
  }
}
