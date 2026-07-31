import { NextRequest } from "next/server";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  resolveProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

const MODEL_PATTERN = /^[A-Z0-9_-]{1,80}$/;
const BARCODE_PATTERN = /^[A-Z0-9_-]{1,120}$/;
const INTEGRATION_HEADER = "x-commerce-os-integration-secret";

type CachedOption = {
  id?: unknown;
  optionName?: unknown;
  saleOption?: unknown;
  chinaOption?: unknown;
  barcode?: unknown;
  baseSalePriceKrw?: unknown;
  unitCostKrw?: unknown;
  sourceOrderItemId?: unknown;
};

type CachedSnapshot = {
  ok?: unknown;
  batchId?: unknown;
  batchTitle?: unknown;
  batchStatus?: unknown;
  modelNumber?: unknown;
  productName?: unknown;
  pricingRule?: unknown;
  options?: unknown;
  issues?: unknown;
  syncedAt?: unknown;
  source?: unknown;
};

type TrackerItem = {
  modelNumber?: unknown;
  barcode?: unknown;
  productName?: unknown;
  orderOptions?: unknown;
  chinaOrderLink?: unknown;
};

export async function GET(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  const barcode = normalizeIdentifier(
    request.nextUrl.searchParams.get("barcode"),
    BARCODE_PATTERN,
  );
  const modelNumber = normalizeIdentifier(
    request.nextUrl.searchParams.get("modelNumber"),
    MODEL_PATTERN,
  );
  if (!barcode && !modelNumber) {
    return Response.json(
      {
        ok: false,
        code: "BARCODE_OR_MODEL_REQUIRED",
        message: "기준 바코드 또는 모델번호가 필요합니다.",
      },
      { status: 400 },
    );
  }

  const cached = await readCachedSnapshot(
    identity.value.userId,
    barcode,
    modelNumber,
  );
  if (cached) return Response.json(cached, { status: 200 });

  const baseUrl = process.env.CHINA_ORDER_MANAGER_BASE_URL?.trim().replace(/\/$/, "");
  const secret = process.env.CHINA_ORDER_MANAGER_INTEGRATION_SECRET?.trim();
  if (!baseUrl || !secret) {
    return Response.json(
      {
        ok: false,
        code: "CHINA_ORDER_INTEGRATION_NOT_CONFIGURED",
        message:
          "발주·입고관리 연동 환경변수(CHINA_ORDER_MANAGER_BASE_URL, CHINA_ORDER_MANAGER_INTEGRATION_SECRET)가 필요합니다.",
      },
      { status: 503 },
    );
  }

  const query = new URLSearchParams();
  if (barcode) query.set("barcode", barcode);
  if (modelNumber) query.set("modelNumber", modelNumber);

  let response: Response;
  try {
    response = await fetch(
      `${baseUrl}/api/integrations/product-launch-options?${query.toString()}`,
      {
        headers: {
          Accept: "application/json",
          [INTEGRATION_HEADER]: secret,
          Authorization: `Bearer ${secret}`,
        },
        cache: "no-store",
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "CHINA_ORDER_NETWORK_FAILED",
        message:
          "비공개 China Order Manager Site에는 Ops Center 서버가 직접 접근할 수 없습니다. China Order Manager에서 Ops Center 동기화를 먼저 실행하세요.",
        detail: error instanceof Error ? error.message : "",
      },
      { status: 502 },
    );
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok || !isSuccessfulSnapshot(body)) {
    return Response.json(
      {
        ok: false,
        code: readCode(body) || "CHINA_ORDER_CACHE_REQUIRED",
        message:
          readMessage(body) ||
          "China Order Manager가 비공개 Site입니다. 중국 발주·입고 관리에서 Ops Center 동기화를 실행한 뒤 다시 불러오세요.",
        upstreamStatus: response.status,
      },
      {
        status:
          response.status >= 400 && response.status < 500
            ? response.status
            : 502,
      },
    );
  }

  return Response.json(body, { status: 200 });
}

async function readCachedSnapshot(
  ownerId: string,
  barcode: string,
  modelNumber: string,
) {
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return null;
  try {
    const stored = await readProductLaunchState(config.value, ownerId);
    const state = stored?.state_payload;
    if (!state || typeof state !== "object" || Array.isArray(state)) return null;
    const payload = state as {
      items?: unknown;
      chinaOrderOptionsCache?: unknown;
    };

    const cache =
      payload.chinaOrderOptionsCache &&
      typeof payload.chinaOrderOptionsCache === "object" &&
      !Array.isArray(payload.chinaOrderOptionsCache)
        ? (payload.chinaOrderOptionsCache as Record<string, unknown>)
        : {};
    if (modelNumber) {
      const direct = normalizeCachedSnapshot(cache[modelNumber]);
      if (direct) return direct;
    }

    const items = Array.isArray(payload.items)
      ? (payload.items as TrackerItem[])
      : [];
    const item = items.find((candidate) => {
      const itemModel = normalizeIdentifier(
        String(candidate.modelNumber ?? ""),
        MODEL_PATTERN,
      );
      if (modelNumber && itemModel === modelNumber) return true;
      const itemBarcode = normalizeIdentifier(
        String(candidate.barcode ?? ""),
        BARCODE_PATTERN,
      );
      if (barcode && itemBarcode === barcode) return true;
      if (!barcode || !Array.isArray(candidate.orderOptions)) return false;
      return candidate.orderOptions.some(
        (option) =>
          normalizeIdentifier(
            String((option as CachedOption)?.barcode ?? ""),
            BARCODE_PATTERN,
          ) === barcode,
      );
    });
    if (!item || !Array.isArray(item.orderOptions) || !item.orderOptions.length) {
      return null;
    }

    const options = normalizeCachedOptions(item.orderOptions);
    if (!options.length) return null;
    const link =
      item.chinaOrderLink && typeof item.chinaOrderLink === "object"
        ? (item.chinaOrderLink as {
            batchId?: unknown;
            syncedAt?: unknown;
          })
        : {};
    return {
      ok: true,
      batchId: link.batchId ?? "",
      batchTitle: "Ops Center 저장 캐시",
      batchStatus: "cached",
      modelNumber:
        normalizeIdentifier(String(item.modelNumber ?? ""), MODEL_PATTERN) ||
        modelNumber,
      productName: String(item.productName ?? ""),
      pricingRule: {
        source: "ops_center_cache",
        baseSalePriceMultiplier: 2,
      },
      options,
      issues: [],
      syncedAt:
        validIso(link.syncedAt) || stored?.updated_at || new Date().toISOString(),
      source: "ops_center_state",
    };
  } catch {
    return null;
  }
}

function normalizeCachedSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as CachedSnapshot;
  const options = normalizeCachedOptions(snapshot.options);
  const modelNumber = normalizeIdentifier(
    String(snapshot.modelNumber ?? ""),
    MODEL_PATTERN,
  );
  if (!modelNumber || !options.length) return null;
  return {
    ...snapshot,
    ok: true,
    modelNumber,
    productName: String(snapshot.productName ?? ""),
    options,
    issues: Array.isArray(snapshot.issues) ? snapshot.issues : [],
    syncedAt: validIso(snapshot.syncedAt) || new Date().toISOString(),
    source: String(snapshot.source ?? "ops_center_cache"),
  };
}

function normalizeCachedOptions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const option = raw as CachedOption;
    const barcode = normalizeIdentifier(
      String(option.barcode ?? ""),
      BARCODE_PATTERN,
    );
    const unitCostKrw = Math.ceil(Number(option.unitCostKrw) || 0);
    const baseSalePriceKrw = Math.ceil(Number(option.baseSalePriceKrw) || 0);
    if (!barcode || !(unitCostKrw > 0) || !(baseSalePriceKrw > 0)) return [];
    return [
      {
        id: String(option.id ?? `cached-${index}`),
        optionName: String(option.optionName ?? "옵션").trim() || "옵션",
        saleOption: String(option.saleOption ?? "단품").trim() || "단품",
        chinaOption: String(option.chinaOption ?? "").trim(),
        barcode,
        baseSalePriceKrw,
        unitCostKrw,
        sourceOrderItemId:
          option.sourceOrderItemId == null
            ? null
            : Number(option.sourceOrderItemId) || null,
      },
    ];
  });
}

function normalizeIdentifier(value: string | null, pattern: RegExp) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return pattern.test(normalized) ? normalized : "";
}

function validIso(value: unknown) {
  const candidate = String(value ?? "").trim();
  return Number.isFinite(Date.parse(candidate)) ? candidate : "";
}

function isSuccessfulSnapshot(value: unknown) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as { ok?: unknown }).ok === true &&
      Array.isArray((value as { options?: unknown }).options),
  );
}

function readMessage(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const message = (value as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function readCode(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}
