import {
  INVENTORY_STOCKOUT_RESET_OPERATION_TYPE,
  loadInventoryStockControlReport,
  normalizeStockoutResetInput,
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
      code: "INVENTORY_STOCK_CONTROL_UNAUTHORIZED",
      message: "재고 기준점과 Shopling 상태를 관리할 권한이 필요합니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const report = await loadInventoryStockControlReport();
  return Response.json(
    { ok: report.state === "READY", report },
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
    if (String(body.action ?? "").toUpperCase() !== "RESET_ZERO") {
      return Response.json(
        {
          ok: false,
          code: "INVENTORY_STOCK_CONTROL_ACTION_INVALID",
          message: "지원하지 않는 재고 기준점 작업입니다.",
        },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const event = normalizeStockoutResetInput({
      eventId: body.eventId,
      barcode: body.barcode,
      productKind: body.productKind,
      modelNo: body.modelNo,
      occurredAt: body.occurredAt,
      note: body.note,
    });
    const stored = await storeInventoryOperation({
      operationType: INVENTORY_STOCKOUT_RESET_OPERATION_TYPE,
      sourceEventId: `inventory-stockout-reset:${encodeURIComponent(event.eventId)}`,
      correlationId: `inventory-stock:${event.barcode}`,
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
          ? "이미 저장한 품절 기준점이라 중복 생성하지 않았습니다."
          : "B코드 재고를 0으로 초기화했습니다. 이후 확정입고와 판매만으로 정확재고를 계산합니다.",
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
        code: "INVENTORY_STOCKOUT_RESET_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "품절 기준점을 저장하지 못했습니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
