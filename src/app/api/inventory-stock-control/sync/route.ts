import {
  SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE,
  loadInventoryStockControlReport,
  normalizeShoplingStockSyncInput,
  storeInventoryOperation,
} from "@/lib/inventoryStockControl";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "SHOPLING_STOCK_SYNC_UNAUTHORIZED",
      message: "Shopling 재고상태 동기화 기록 권한이 필요합니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const report = await loadInventoryStockControlReport();
  return Response.json(
    {
      ok: report.state === "READY",
      report,
      jobs: report.rows
        .filter((row) => row.syncNeeded && !row.syncBlocked)
        .map((row) => ({
          jobId: `stock-sync:${row.barcode}:${row.desiredStatus}:${row.desiredSince}`,
          barcode: row.barcode,
          productName: row.productName,
          productKind: row.productKind,
          modelNo: row.modelNo,
          goodsKeys: row.goodsKeys,
          desiredStatus: row.desiredStatus,
          desiredSince: row.desiredSince,
          exactInventoryQuantity: row.exactInventoryQuantity,
          resetAt: row.resetAt,
          route:
            row.productKind === "OPTION"
              ? ["A6_OPTION_STATUS", "A22_OPTION_TRANSMIT"]
              : ["A6_OPTION_STATUS", "A21_PRODUCT_SALE_STATUS"],
        })),
    },
    {
      status: report.state === "READY" ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const event = normalizeShoplingStockSyncInput({
      eventId: body.eventId,
      jobId: body.jobId,
      barcode: body.barcode,
      productKind: body.productKind,
      modelNo: body.modelNo,
      desiredStatus: body.desiredStatus,
      outcome: body.outcome,
      occurredAt: body.occurredAt,
      message: body.message,
      evidence: body.evidence,
    });
    const stored = await storeInventoryOperation({
      operationType: SHOPLING_STOCK_STATUS_SYNC_OPERATION_TYPE,
      sourceEventId: `shopling-stock-sync:${encodeURIComponent(event.eventId)}`,
      correlationId: `shopling-stock:${event.barcode}`,
      snapshot: event,
    });
    const report = await loadInventoryStockControlReport();
    return Response.json(
      {
        ok: true,
        duplicate: stored.duplicate,
        event,
        report,
        message: stored.duplicate
          ? "이미 기록한 Shopling 동기화 결과입니다."
          : "Shopling 재고상태 동기화 결과를 저장했습니다.",
      },
      {
        status: stored.duplicate ? 200 : 201,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_STOCK_SYNC_EVENT_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Shopling 재고상태 동기화 결과를 저장하지 못했습니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
