import { NextRequest } from "next/server";
import { readPriceAdjustmentSalesCache } from "@/lib/priceAdjustmentSalesCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 50;

const INTEGRATION_HEADER = "x-commerce-os-integration-secret";
const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 500;

export async function GET(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  try {
    const cache = await readPriceAdjustmentSalesCache();
    if (!cache || !cache.complete) {
      return Response.json(
        {
          ok: false,
          code: "PRICE_ADJUSTMENT_SALES_CACHE_REQUIRED",
          message:
            "발주·단종 추천 Site에서 판매추이 캐시를 Ops Center로 먼저 동기화하세요.",
        },
        { status: 409 },
      );
    }

    const cursor = request.nextUrl.searchParams.get("cursor")?.trim().toUpperCase() ?? "";
    const requestedLimit = Number(request.nextUrl.searchParams.get("limit"));
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(
        1,
        Number.isFinite(requestedLimit)
          ? Math.floor(requestedLimit)
          : DEFAULT_LIMIT,
      ),
    );
    const barcodes = Object.keys(cache.productsByBarcode)
      .sort((left, right) => left.localeCompare(right))
      .filter((barcode) => !cursor || barcode > cursor);
    const selected = barcodes.slice(0, limit);
    const hasMore = barcodes.length > selected.length;
    const nextCursor = hasMore ? selected.at(-1) ?? null : null;

    return Response.json({
      ok: true,
      generatedAt: cache.generatedAt,
      coverageStart: cache.coverageStart,
      coverageEnd: cache.coverageEnd,
      products: selected.map((barcode) => cache.productsByBarcode[barcode]),
      cache: {
        snapshotId: cache.snapshotId,
        complete: cache.complete,
        productCount: cache.productCount,
        updatedAt: cache.updatedAt,
      },
      page: {
        limit,
        hasMore,
        nextCursor,
      },
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRICE_ADJUSTMENT_SALES_CACHE_READ_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "가격조정 판매추이 캐시를 읽지 못했습니다.",
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
  const custom = request.headers.get(INTEGRATION_HEADER)?.trim() ?? "";
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
        message: "가격조정 판매추이 캐시 인증에 실패했습니다.",
      },
    };
  }
  return { ok: true };
}
