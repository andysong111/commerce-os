import { NextRequest } from "next/server";
import {
  mergePriceAdjustmentReceiptCachePage,
  type PriceAdjustmentReceipt,
} from "@/lib/priceAdjustmentReceiptCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 50;

const MAX_RECEIPTS_PER_PAGE = 500;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export async function POST(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return Response.json(auth.body, { status: auth.status });

  let input: {
    snapshotId: string;
    generatedAt: string;
    complete: boolean;
    receipts: PriceAdjustmentReceipt[];
  };
  try {
    input = normalizeBody(await request.json());
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_PRICE_ADJUSTMENT_RECEIPT_PAGE",
        message:
          error instanceof Error
            ? error.message
            : "가격조정 입고원가 페이지 형식을 확인하세요.",
      },
      { status: 400 },
    );
  }

  try {
    const cache = await mergePriceAdjustmentReceiptCachePage(input);
    return Response.json({
      ok: true,
      snapshotId: cache.snapshotId,
      receivedReceipts: input.receipts.length,
      storedBarcodes: cache.barcodeCount,
      storedReceipts: cache.receiptCount,
      complete: cache.complete,
      updatedAt: cache.updatedAt,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRICE_ADJUSTMENT_RECEIPT_CACHE_SAVE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "가격조정 입고원가 캐시를 저장하지 못했습니다.",
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

function normalizeBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("입고원가 페이지 객체가 필요합니다.");
  }
  const raw = value as Record<string, unknown>;
  const snapshotId = text(raw.snapshotId);
  if (!snapshotId || snapshotId.length > 120) {
    throw new Error("입고원가 스냅샷 번호를 확인하세요.");
  }
  const generatedAt = validIso(raw.generatedAt);
  if (!generatedAt) throw new Error("입고원가 생성시각을 확인하세요.");
  const source = Array.isArray(raw.receipts) ? raw.receipts : [];
  if (source.length > MAX_RECEIPTS_PER_PAGE) {
    throw new Error(`한 페이지는 최대 ${MAX_RECEIPTS_PER_PAGE}개 입고행입니다.`);
  }
  const seen = new Set<string>();
  const receipts = source.map((row, index) => {
    const receipt = normalizeReceipt(row, index);
    const key = `${receipt.barcode}|${receipt.id}`;
    if (seen.has(key)) {
      throw new Error(`${receipt.barcode}의 ${receipt.id} 입고행이 중복되었습니다.`);
    }
    seen.add(key);
    return receipt;
  });
  return {
    snapshotId,
    generatedAt,
    complete: raw.complete === true,
    receipts,
  };
}

function normalizeReceipt(value: unknown, index: number): PriceAdjustmentReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`입고행 ${index + 1} 형식을 확인하세요.`);
  }
  const raw = value as Record<string, unknown>;
  const id = text(raw.id);
  const barcode = normalizeBarcode(raw.barcode);
  const receivedAt = validIso(raw.receivedAt);
  const quantity = positiveNumber(raw.quantity);
  const unitCostKrw = positiveNumber(raw.unitCostKrw);
  if (!id || id.length > 160) throw new Error(`입고행 ${index + 1} 번호를 확인하세요.`);
  if (
    !barcode ||
    barcode.length > 120 ||
    CONTROL_CHARACTER_PATTERN.test(barcode)
  ) {
    throw new Error(`입고행 ${index + 1}의 바코드를 확인하세요.`);
  }
  if (!receivedAt) throw new Error(`${barcode}의 입고확정시각을 확인하세요.`);
  if (!(quantity > 0)) throw new Error(`${barcode}의 정상입고수량을 확인하세요.`);
  if (!(unitCostKrw > 0)) throw new Error(`${barcode}의 개당 입고원가를 확인하세요.`);
  return {
    id,
    receiptId: text(raw.receiptId) || id,
    batchId: nonNegativeInteger(raw.batchId),
    orderItemId: nonNegativeInteger(raw.orderItemId),
    barcode,
    modelNumber: text(raw.modelNumber),
    optionName: text(raw.optionName),
    quantity,
    unitCostKrw: Math.ceil(unitCostKrw),
    receivedAt,
  };
}

function normalizeBarcode(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().toUpperCase();
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function nonNegativeInteger(value: unknown) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function validIso(value: unknown) {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}
