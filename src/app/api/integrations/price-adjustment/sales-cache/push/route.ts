import { NextRequest } from "next/server";
import {
  mergePriceAdjustmentSalesCachePage,
  type PriceAdjustmentSalesProduct,
} from "@/lib/priceAdjustmentSalesCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 50;

const INTEGRATION_HEADER = "x-commerce-os-integration-secret";
const MAX_PRODUCTS_PER_PAGE = 250;
const MAX_MONTHS = 24;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const GOODS_KEY_PATTERN = /^\d+$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

export async function POST(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  let input: {
    snapshotId: string;
    generatedAt: string;
    coverageStart: string | null;
    coverageEnd: string | null;
    complete: boolean;
    products: PriceAdjustmentSalesProduct[];
  };
  try {
    input = normalizeBody(await request.json());
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_PRICE_ADJUSTMENT_SALES_PAGE",
        message:
          error instanceof Error
            ? error.message
            : "가격조정 판매추이 페이지 형식을 확인하세요.",
      },
      { status: 400 },
    );
  }

  try {
    const cache = await mergePriceAdjustmentSalesCachePage(input);
    return Response.json({
      ok: true,
      snapshotId: cache.snapshotId,
      receivedProducts: input.products.length,
      storedProducts: cache.productCount,
      complete: cache.complete,
      updatedAt: cache.updatedAt,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRICE_ADJUSTMENT_SALES_CACHE_SAVE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "가격조정 판매추이 캐시를 저장하지 못했습니다.",
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

function normalizeBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("판매추이 페이지 객체가 필요합니다.");
  }
  const raw = value as Record<string, unknown>;
  const snapshotId = text(raw.snapshotId);
  if (!snapshotId || snapshotId.length > 120) {
    throw new Error("판매추이 스냅샷 번호를 확인하세요.");
  }
  const generatedAt = validIso(raw.generatedAt);
  if (!generatedAt) throw new Error("판매추이 생성시각을 확인하세요.");
  const source = Array.isArray(raw.products) ? raw.products : [];
  if (source.length > MAX_PRODUCTS_PER_PAGE) {
    throw new Error(`한 페이지는 최대 ${MAX_PRODUCTS_PER_PAGE}개 상품입니다.`);
  }
  const seen = new Set<string>();
  const products = source.map((product, index) => {
    const normalized = normalizeProduct(product, index);
    if (seen.has(normalized.barcode)) {
      throw new Error(`${normalized.barcode} 바코드가 페이지 안에서 중복되었습니다.`);
    }
    seen.add(normalized.barcode);
    return normalized;
  });
  return {
    snapshotId,
    generatedAt,
    coverageStart: validIso(raw.coverageStart),
    coverageEnd: validIso(raw.coverageEnd),
    complete: raw.complete === true,
    products,
  };
}

function normalizeProduct(value: unknown, index: number): PriceAdjustmentSalesProduct {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`상품 ${index + 1} 형식을 확인하세요.`);
  }
  const raw = value as Record<string, unknown>;
  const barcode = text(raw.barcode).normalize("NFKC").toUpperCase();
  if (
    !barcode ||
    barcode.length > 120 ||
    CONTROL_CHARACTER_PATTERN.test(barcode)
  ) {
    throw new Error(`상품 ${index + 1}의 바코드·위치코드를 확인하세요.`);
  }
  const sourceMonths = Array.isArray(raw.months) ? raw.months : [];
  if (sourceMonths.length > MAX_MONTHS) {
    throw new Error(`${barcode}의 판매이력은 최대 ${MAX_MONTHS}개월입니다.`);
  }
  const months = sourceMonths.map((month, monthIndex) => {
    if (!month || typeof month !== "object" || Array.isArray(month)) {
      throw new Error(`${barcode}의 ${monthIndex + 1}번째 월 데이터를 확인하세요.`);
    }
    const point = month as Record<string, unknown>;
    const monthKey = text(point.month);
    if (!MONTH_PATTERN.test(monthKey)) {
      throw new Error(`${barcode}의 판매 월 형식을 확인하세요.`);
    }
    return {
      month: monthKey,
      quantity: nonNegativeInteger(point.quantity),
      revenue: nonNegativeInteger(point.revenue),
    };
  });
  const goodsKeys = [
    ...new Set(
      (Array.isArray(raw.goodsKeys) ? raw.goodsKeys : [])
        .map((value) => text(value))
        .filter((value) => GOODS_KEY_PATTERN.test(value)),
    ),
  ];
  return {
    barcode,
    name: text(raw.name) || barcode,
    modelNumber: text(raw.modelNumber) || null,
    goodsKeys,
    active: raw.active !== false,
    unitCost: nonNegativeInteger(raw.unitCost),
    lastSaleAt: validIso(raw.lastSaleAt),
    historyStart: validIso(raw.historyStart),
    months,
  };
}

function validIso(value: unknown) {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function nonNegativeInteger(value: unknown) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function text(value: unknown) {
  return String(value ?? "").trim();
}
