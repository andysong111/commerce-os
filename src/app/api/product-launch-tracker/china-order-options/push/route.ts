import { NextRequest } from "next/server";
import { temporaryOpsIdentity } from "@/lib/opsLoginBypass";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";

const INTEGRATION_HEADER = "x-commerce-os-integration-secret";
const MODEL_PATTERN = /^[A-Z0-9_-]{1,80}$/;
const BARCODE_PATTERN = /^[A-Z0-9_-]{1,120}$/;
const MAX_SNAPSHOTS = 500;
const MAX_OPTIONS_PER_MODEL = 500;

type RawOption = {
  id?: unknown;
  optionName?: unknown;
  saleOption?: unknown;
  chinaOption?: unknown;
  barcode?: unknown;
  baseSalePriceKrw?: unknown;
  unitCostKrw?: unknown;
  sourceOrderItemId?: unknown;
};

type RawSnapshot = {
  batchId?: unknown;
  batchTitle?: unknown;
  batchStatus?: unknown;
  modelNumber?: unknown;
  productName?: unknown;
  pricingRule?: unknown;
  options?: unknown;
  syncedAt?: unknown;
};

type TrackerItem = {
  modelNumber?: unknown;
  barcode?: unknown;
  productName?: unknown;
  orderOptions?: unknown;
  chinaOrderLink?: unknown;
  updatedAt?: unknown;
  updatedBy?: unknown;
  [key: string]: unknown;
};

type TrackerState = {
  schemaVersion?: unknown;
  savedAt?: unknown;
  items?: unknown;
  chinaOrderOptionsCache?: unknown;
  [key: string]: unknown;
};

type NormalizedSnapshot = ReturnType<typeof normalizeSnapshot>;

export async function POST(request: NextRequest) {
  const expected = process.env.CHINA_ORDER_MANAGER_INTEGRATION_SECRET?.trim();
  const provided = request.headers.get(INTEGRATION_HEADER)?.trim() ?? "";
  if (!expected) {
    return Response.json(
      {
        ok: false,
        code: "INTEGRATION_SECRET_NOT_CONFIGURED",
        message: "Ops Center의 발주·입고 연동 비밀값이 설정되지 않았습니다.",
      },
      { status: 503 },
    );
  }
  if (!provided || provided !== expected) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_INTEGRATION_SECRET",
        message: "Ops Center 발주·입고 연동 인증에 실패했습니다.",
      },
      { status: 401 },
    );
  }

  let snapshots: NormalizedSnapshot[];
  try {
    const body = (await request.json()) as {
      snapshots?: unknown;
      snapshot?: unknown;
    };
    const source = Array.isArray(body.snapshots)
      ? body.snapshots
      : body.snapshot
        ? [body.snapshot]
        : [];
    if (!source.length || source.length > MAX_SNAPSHOTS) {
      throw new Error(`동기화 상품은 1~${MAX_SNAPSHOTS}건이어야 합니다.`);
    }
    snapshots = source.map(normalizeSnapshot);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_CHINA_ORDER_SNAPSHOT",
        message:
          error instanceof Error
            ? error.message
            : "발주·입고 옵션 데이터가 올바르지 않습니다.",
      },
      { status: 400 },
    );
  }

  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });
  const identity = temporaryOpsIdentity();

  try {
    const stored = await readProductLaunchState(config.value, identity.userId);
    const state = normalizeState(stored?.state_payload);
    const items = state.items;
    const cache = normalizeCache(state.chinaOrderOptionsCache);
    let updatedItems = 0;
    const syncedModels: string[] = [];

    for (const snapshot of snapshots) {
      cache[snapshot.modelNumber] = snapshot;
      let matched = false;
      for (const item of items) {
        if (!matchesItem(item, snapshot)) continue;
        matched = true;
        updatedItems += 1;
        item.orderOptions = snapshot.options;
        item.chinaOrderLink = {
          status: "linked",
          batchId: String(snapshot.batchId ?? ""),
          syncedAt: snapshot.syncedAt,
          message: "China Order Manager 서버 푸시 동기화",
        };
        item.updatedAt = snapshot.syncedAt;
        item.updatedBy = "China Order Manager";
      }
      if (matched) syncedModels.push(snapshot.modelNumber);
    }

    const nextState: TrackerState = {
      ...state,
      schemaVersion: Math.max(3, Number(state.schemaVersion) || 3),
      savedAt: new Date().toISOString(),
      items,
      chinaOrderOptionsCache: cache,
    };
    await writeProductLaunchState(config.value, identity, nextState);

    return Response.json({
      ok: true,
      receivedSnapshots: snapshots.length,
      updatedItems,
      syncedModels,
      savedAt: nextState.savedAt,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "CHINA_ORDER_PUSH_SAVE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "발주·입고 옵션을 Ops Center에 저장하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

function normalizeSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("상품별 옵션 스냅샷 객체가 필요합니다.");
  }
  const raw = value as RawSnapshot;
  const modelNumber = normalizeCode(raw.modelNumber);
  if (!MODEL_PATTERN.test(modelNumber)) {
    throw new Error("모델번호 형식을 확인하세요.");
  }
  const sourceOptions = Array.isArray(raw.options) ? raw.options : [];
  if (!sourceOptions.length || sourceOptions.length > MAX_OPTIONS_PER_MODEL) {
    throw new Error(
      `${modelNumber}의 옵션은 1~${MAX_OPTIONS_PER_MODEL}개여야 합니다.`,
    );
  }
  const options = sourceOptions.map((option, index) =>
    normalizeOption(option as RawOption, index),
  );
  return {
    ok: true,
    batchId: numberOrText(raw.batchId),
    batchTitle: text(raw.batchTitle),
    batchStatus: text(raw.batchStatus),
    modelNumber,
    productName: text(raw.productName),
    pricingRule:
      raw.pricingRule && typeof raw.pricingRule === "object"
        ? raw.pricingRule
        : { source: "china_order_manager", baseSalePriceMultiplier: 2 },
    options,
    issues: [],
    syncedAt: validIso(raw.syncedAt) || new Date().toISOString(),
    source: "china_order_manager_push",
  };
}

function normalizeOption(raw: RawOption, index: number) {
  const barcode = normalizeCode(raw.barcode);
  if (!BARCODE_PATTERN.test(barcode)) {
    throw new Error(`옵션 ${index + 1}의 바코드·위치코드를 확인하세요.`);
  }
  const unitCostKrw = positiveInteger(raw.unitCostKrw);
  const baseSalePriceKrw = positiveInteger(raw.baseSalePriceKrw);
  if (!(unitCostKrw > 0) || !(baseSalePriceKrw > 0)) {
    throw new Error(`옵션 ${index + 1}의 원가와 기준 판매가가 필요합니다.`);
  }
  return {
    id: text(raw.id) || `china-order-${crypto.randomUUID()}`,
    optionName: text(raw.optionName) || "옵션",
    saleOption: text(raw.saleOption) || "단품",
    chinaOption: text(raw.chinaOption),
    barcode,
    baseSalePriceKrw,
    unitCostKrw,
    sourceOrderItemId:
      raw.sourceOrderItemId == null ? null : Number(raw.sourceOrderItemId) || null,
  };
}

function normalizeState(value: unknown): TrackerState & { items: TrackerItem[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("신규 상품 출시 진행관리 서버 저장본이 없습니다.");
  }
  const state = structuredClone(value) as TrackerState;
  if (!Array.isArray(state.items)) {
    throw new Error("신규 상품 출시 진행관리 상품 목록이 없습니다.");
  }
  return state as TrackerState & { items: TrackerItem[] };
}

function normalizeCache(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, NormalizedSnapshot>;
  }
  return structuredClone(value) as Record<string, NormalizedSnapshot>;
}

function matchesItem(item: TrackerItem, snapshot: NormalizedSnapshot) {
  const itemModel = normalizeCode(item.modelNumber);
  if (itemModel && itemModel === snapshot.modelNumber) return true;
  const itemBarcode = normalizeCode(item.barcode);
  return Boolean(
    itemBarcode &&
      snapshot.options.some((option) => option.barcode === itemBarcode),
  );
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeCode(value: unknown) {
  return text(value).toUpperCase();
}

function positiveInteger(value: unknown) {
  const number = Math.ceil(Number(value) || 0);
  return number > 0 ? number : 0;
}

function validIso(value: unknown) {
  const candidate = text(value);
  return Number.isFinite(Date.parse(candidate)) ? candidate : "";
}

function numberOrText(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : text(value);
}
