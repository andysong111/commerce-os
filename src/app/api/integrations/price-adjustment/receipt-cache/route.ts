import { NextRequest } from "next/server";
import {
  readPriceAdjustmentReceiptCache,
  type PriceAdjustmentReceipt,
} from "@/lib/priceAdjustmentReceiptCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 500;

export async function GET(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  try {
    const cache = await readPriceAdjustmentReceiptCache();
    if (!cache || !cache.complete) {
      return Response.json(
        {
          ok: false,
          code: "OPS_CENTER_RECEIPT_CACHE_NOT_READY",
          message:
            "중국 발주·입고 관리 Site에서 입고원가 캐시를 Ops Center로 먼저 동기화하세요.",
        },
        { status: 409 },
      );
    }

    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit"));
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(
        1,
        Number.isFinite(requestedLimit)
          ? Math.floor(requestedLimit)
          : DEFAULT_LIMIT,
      ),
    );
    const cursor = String(url.searchParams.get("cursor") ?? "").trim();
    const rows = Object.values(cache.receiptsByBarcode)
      .flat()
      .sort(compareOldestFirst);
    const start = cursor
      ? Math.max(0, rows.findIndex((row) => rowCursor(row) === cursor) + 1)
      : 0;
    const receipts = rows.slice(start, start + limit);
    const hasMore = start + receipts.length < rows.length;
    const nextCursor = hasMore && receipts.length
      ? rowCursor(receipts[receipts.length - 1])
      : null;

    return Response.json({
      ok: true,
      generatedAt: cache.generatedAt,
      updatedAt: cache.updatedAt,
      barcodeCount: cache.barcodeCount,
      receiptCount: cache.receiptCount,
      receipts,
      page: { limit, hasMore, nextCursor },
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "OPS_CENTER_RECEIPT_CACHE_READ_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "가격조정 입고원가 캐시를 읽지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

function authorize(request: NextRequest):
  | { ok: true }
  | {
      ok: false;
      status: number;
      body: { ok: false; code: string; message: string };
    } {
  const expected = process.env.PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET?.trim();
  const custom = request.headers
    .get("x-commerce-os-integration-secret")
    ?.trim() ?? "";
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!expected) {
    return {
      ok: false,
      status: 503,
      body: {
        ok: false,
        code: "PRICE_ADJUSTMENT_SECRET_NOT_CONFIGURED",
        message: "Ops Center의 가격조정 연동 비밀값이 설정되지 않았습니다.",
      },
    };
  }
  if ((custom || bearer) !== expected) {
    return {
      ok: false,
      status: 401,
      body: {
        ok: false,
        code: "INVALID_PRICE_ADJUSTMENT_SECRET",
        message: "가격조정 입고원가 캐시 인증에 실패했습니다.",
      },
    };
  }
  return { ok: true };
}

function compareOldestFirst(
  left: PriceAdjustmentReceipt,
  right: PriceAdjustmentReceipt,
) {
  const time = Date.parse(left.receivedAt) - Date.parse(right.receivedAt);
  if (time !== 0) return time;
  return left.id.localeCompare(right.id);
}

function rowCursor(row: PriceAdjustmentReceipt) {
  return `${row.receivedAt}|${row.id}`;
}
