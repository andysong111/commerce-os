import { randomUUID } from "node:crypto";
import {
  createPendingShoplingInventorySync,
  loadInventoryLifecycleSnapshot,
  recordInventoryStockoutReset,
  recordShoplingInventorySyncEvent,
  type ShoplingInventoryDesiredStatus,
  type ShoplingInventoryProductMode,
  type ShoplingInventorySyncState,
} from "@/lib/inventoryLifecycleLedger";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function productMode(value: unknown): ShoplingInventoryProductMode {
  return text(value).toUpperCase() === "SINGLE" ? "SINGLE" : "OPTION";
}

function unauthorized() {
  return Response.json(
    {
      ok: false,
      code: "INVENTORY_LIFECYCLE_UNAUTHORIZED",
      message: "재고 초기화·Shopling 상태전환 권한이 필요합니다.",
    },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  const snapshot = await loadInventoryLifecycleSnapshot();
  return Response.json(
    { ok: snapshot.state === "READY", snapshot },
    {
      status: snapshot.state === "READY" ? 200 : 409,
      headers: { "cache-control": "no-store" },
    },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginOpsRequest(request)) return unauthorized();
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = text(body.action).toUpperCase();
    const barcode = text(body.barcode).toUpperCase();
    const mode = productMode(body.productMode);
    const modelNo = text(body.modelNo) || null;
    const productName = text(body.productName) || barcode;

    if (action === "STOCKOUT") {
      const reset = await recordInventoryStockoutReset({
        barcode,
        modelNo,
        productName,
        productMode: mode,
        reason: text(body.reason) || "운영자가 실물 품절을 확인해 재고 기준점을 0으로 초기화",
        sourceEventId:
          text(body.sourceEventId) ||
          `inventory-stockout-reset:${barcode}:${Date.now()}:${randomUUID().slice(0, 8)}`,
      });
      const sync = await createPendingShoplingInventorySync({
        barcode,
        modelNo,
        productName,
        productMode: mode,
        desiredStatus: "SOLD_OUT",
        message:
          mode === "OPTION"
            ? "A6 옵션상태 품절 전환 후 A22 쇼핑몰 상품옵션전송 대기"
            : "A6 품절 전환 후 A21 상품판매상태 품절 수정전송 대기",
      });
      return Response.json(
        {
          ok: true,
          reset,
          job: sync.event,
          message:
            "재고 기준점은 0으로 확정했습니다. Shopling 품절 반영은 별도 작업으로 대기 중이며 실패해도 재고 초기화는 취소되지 않습니다.",
        },
        { status: 201, headers: { "cache-control": "no-store" } },
      );
    }

    if (action === "RESTORE") {
      const snapshot = await loadInventoryLifecycleSnapshot();
      const row = snapshot.rows.find((item) => item.barcode === barcode);
      if (!row) {
        throw new Error("INVENTORY_RESTORE_RESET_NOT_FOUND");
      }
      if (!row.exactInventoryKnown || (row.exactInventoryQuantity ?? 0) <= 0) {
        throw new Error("INVENTORY_RESTORE_POSITIVE_EXACT_STOCK_REQUIRED");
      }
      const sync = await createPendingShoplingInventorySync({
        barcode,
        modelNo: modelNo || row.modelNo,
        productName: productName || row.productName,
        productMode: mode || row.productMode,
        desiredStatus: "SELLING",
        message:
          row.productMode === "OPTION"
            ? "확정입고 감지 · A6 옵션상태 판매중 전환 후 A22 상품옵션전송 대기"
            : "확정입고 감지 · A6 판매중 전환 후 A21 상품판매상태 판매중 수정전송 대기",
      });
      return Response.json(
        {
          ok: true,
          job: sync.event,
          inventory: {
            exactInventoryQuantity: row.exactInventoryQuantity,
            inboundAfterReset: row.inboundAfterReset,
            salesAfterReset: row.salesAfterReset,
          },
          message:
            "품절 초기화 이후 확정재고가 양수라 판매중 복구 작업을 대기열에 넣었습니다.",
        },
        { status: 201, headers: { "cache-control": "no-store" } },
      );
    }

    if (action === "SYNC_EVENT") {
      const desiredStatus = text(body.desiredStatus).toUpperCase();
      const state = text(body.state).toUpperCase();
      if (!["SOLD_OUT", "SELLING"].includes(desiredStatus)) {
        throw new Error("SHOPLING_INVENTORY_SYNC_DESIRED_STATUS_INVALID");
      }
      if (!["PENDING", "RUNNING", "SUCCEEDED", "FAILED"].includes(state)) {
        throw new Error("SHOPLING_INVENTORY_SYNC_EVENT_STATE_INVALID");
      }
      const stored = await recordShoplingInventorySyncEvent({
        jobId: text(body.jobId),
        barcode,
        modelNo,
        productName,
        productMode: mode,
        desiredStatus: desiredStatus as ShoplingInventoryDesiredStatus,
        state: state as ShoplingInventorySyncState,
        stage: text(body.stage),
        message: text(body.message),
        errorCode: text(body.errorCode) || null,
        sourceEventId:
          text(body.sourceEventId) ||
          `shopling-inventory-sync:${text(body.jobId)}:${state}:${text(body.stage) || "stage"}:${Date.now()}`,
      });
      return Response.json(
        { ok: true, event: stored.event, duplicate: stored.duplicate },
        { status: stored.duplicate ? 200 : 201, headers: { "cache-control": "no-store" } },
      );
    }

    throw new Error("INVENTORY_LIFECYCLE_ACTION_UNSUPPORTED");
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "재고·Shopling 상태작업을 처리하지 못했습니다.";
    return Response.json(
      {
        ok: false,
        code: message.split(":", 1)[0] || "INVENTORY_LIFECYCLE_FAILED",
        message,
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
