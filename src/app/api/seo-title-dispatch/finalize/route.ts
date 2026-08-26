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
  const dispatchId = text(input.dispatchId);
  const reservationId = text(input.reservationId);
  const success = input.success !== false;

  if (!dispatchId || !reservationId) {
    return Response.json(
      {
        ok: false,
        code: "SEO_TITLE_FINALIZE_INPUT_REQUIRED",
        message: "출고 계획 ID와 상품명 예약 ID가 필요합니다.",
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
    const now = new Date().toISOString();
    await Promise.all([
      patchSeoTitleDispatch(context, dispatchId, {
        status: success ? "success" : "partial",
        completed_at: now,
        result_payload: {
          mode: "shopling_inventory_relaunch",
          externalWriteExecuted: true,
          inventoryFinalized: true,
          inventoryDisposition: success ? "used" : "review",
          finalizedAt: now,
        },
      }),
      patchSeoTitleDispatchItems(context, dispatchId, {
        status: success ? "success" : "failed",
        error_message: success ? "" : "Shopling 일부 채널 등록으로 상품명 재고 검토 필요",
      }),
    ]);
    return Response.json({
      ok: true,
      dispatchId,
      reservationId,
      success,
      affected: Number(affected) || 0,
      finalizedAt: now,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SEO_TITLE_FINALIZE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Shopling 재등록 결과에 맞춰 상품명 재고 상태를 확정하지 못했습니다.",
      },
      { status: 400 },
    );
  }
}
