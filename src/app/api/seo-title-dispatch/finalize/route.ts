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
        p_success: true,
      },
    );
    const now = new Date().toISOString();
    await Promise.all([
      patchSeoTitleDispatch(context, dispatchId, {
        status: "success",
        completed_at: now,
        result_payload: {
          mode: "shopling_inventory_relaunch",
          externalWriteExecuted: true,
          inventoryFinalized: true,
          finalizedAt: now,
        },
      }),
      patchSeoTitleDispatchItems(context, dispatchId, {
        status: "success",
        error_message: "",
      }),
    ]);
    return Response.json({
      ok: true,
      dispatchId,
      reservationId,
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
            : "샵플링 재등록 성공 후 상품명 재고를 사용완료 처리하지 못했습니다.",
      },
      { status: 400 },
    );
  }
}
