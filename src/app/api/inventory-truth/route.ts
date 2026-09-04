import {
  loadInventoryTruthSnapshot,
  recordReceiptConfirmedAndMaybeRestore,
  recordShoplingSyncResult,
  recordStockoutReset,
  type ShoplingProductKind,
  type ShoplingSaleState,
} from "@/lib/inventoryTruthLedger";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "INVENTORY_TRUTH_UNAUTHORIZED",
      message: "Commerce OS 운영 화면에서만 재고 기준점을 변경할 수 있습니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const snapshot = await loadInventoryTruthSnapshot();
  return Response.json(
    {
      ok: !snapshot.error,
      generatedAt: snapshot.generatedAt,
      analysisAsOf: snapshot.analysisAsOf,
      positions: snapshot.positions,
      pendingTasks: snapshot.pendingTasks,
      fingerprint: snapshot.fingerprint,
      error: snapshot.error,
    },
    {
      status: snapshot.error ? 503 : 200,
      headers: { "cache-control": "no-store" },
    },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const body = (await request.json()) as {
      action?: string;
      barcode?: string;
      productKind?: ShoplingProductKind;
      modelNo?: string | null;
      note?: string;
      taskId?: string;
      targetState?: ShoplingSaleState;
      success?: boolean;
      message?: string;
      quantityDelta?: number;
      sourceSystem?: string;
      sourceLineId?: string;
      sourceEventId?: string;
      payload?: unknown;
    };
    if (body.action === "RESET_STOCKOUT") {
      const result = await recordStockoutReset({
        barcode: body.barcode ?? "",
        productKind: body.productKind,
        modelNo: body.modelNo,
        note: body.note,
      });
      const snapshot = await loadInventoryTruthSnapshot();
      return Response.json(
        {
          ok: true,
          taskId: result.taskId,
          identity: result.identity,
          position: snapshot.byBarcode.get(result.reset.event.barcode) ?? null,
          pendingTasks: snapshot.pendingTasks,
          message:
            "B코드 재고를 0으로 초기화하고 Shopling 품절 동기화 작업을 만들었습니다.",
        },
        { status: 201, headers: { "cache-control": "no-store" } },
      );
    }
    if (body.action === "SYNC_RESULT") {
      if (
        !body.taskId ||
        !body.barcode ||
        !body.targetState ||
        !body.productKind ||
        typeof body.success !== "boolean"
      ) {
        throw new Error("INVENTORY_TRUTH_SYNC_RESULT_REQUIRED");
      }
      const result = await recordShoplingSyncResult({
        taskId: body.taskId,
        barcode: body.barcode,
        targetState: body.targetState,
        productKind: body.productKind,
        success: body.success,
        message: body.message,
        payload: body.payload,
      });
      return Response.json(
        {
          ok: true,
          duplicate: result.duplicate,
          event: result.event,
          message: body.success
            ? "Shopling 판매상태 동기화 완료를 기록했습니다."
            : "Shopling 판매상태 동기화 실패를 기록해 재시도 대상으로 남겼습니다.",
        },
        { status: 200, headers: { "cache-control": "no-store" } },
      );
    }
    if (body.action === "MANUAL_RECEIPT") {
      if (
        !body.barcode ||
        !body.sourceSystem ||
        !body.sourceLineId ||
        !body.sourceEventId ||
        !Number.isFinite(Number(body.quantityDelta)) ||
        Number(body.quantityDelta) <= 0
      ) {
        throw new Error("INVENTORY_TRUTH_MANUAL_RECEIPT_REQUIRED");
      }
      const result = await recordReceiptConfirmedAndMaybeRestore({
        barcode: body.barcode,
        sourceSystem: body.sourceSystem,
        sourceLineId: body.sourceLineId,
        sourceEventId: body.sourceEventId,
        quantityDelta: Number(body.quantityDelta),
        note: body.note,
      });
      const snapshot = await loadInventoryTruthSnapshot();
      return Response.json(
        {
          ok: true,
          result,
          position: snapshot.byBarcode.get(body.barcode.toUpperCase()) ?? null,
          pendingTasks: snapshot.pendingTasks,
          message:
            "입고수량을 정확재고에 반영했고, 기존 품절 B코드라면 판매중 복구 작업을 만들었습니다.",
        },
        { status: 201, headers: { "cache-control": "no-store" } },
      );
    }
    return Response.json(
      {
        ok: false,
        code: "INVENTORY_TRUTH_ACTION_INVALID",
        message: "지원하지 않는 재고 기준점 작업입니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "INVENTORY_TRUTH_ACTION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "재고 기준점 작업을 처리하지 못했습니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
