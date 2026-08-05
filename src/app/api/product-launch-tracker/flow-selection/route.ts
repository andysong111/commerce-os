import { NextRequest } from "next/server";
import {
  assignProductLaunchTrackerRowNumbers,
  resolveProductLaunchTrackerSelection,
} from "@/lib/productLaunchTrackerRows";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  resolveProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

const CHANNELS = [
  { key: "wholesale1", label: "도매1", suffix: "a" },
  { key: "wholesale2", label: "도매2", suffix: "b" },
  { key: "wholesale3", label: "도매3", suffix: "c" },
  { key: "wholesale4", label: "도매4", suffix: "d" },
  { key: "retail1", label: "소매1", suffix: "e" },
  { key: "retail2", label: "소매2", suffix: "f" },
] as const;

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = asRecord(parsed);
  } catch {
    return Response.json(
      { ok: false, code: "INVALID_REQUEST", message: "요청 JSON을 읽을 수 없습니다." },
      { status: 400 },
    );
  }

  try {
    const row = await readProductLaunchState(config.value, identity.value.userId);
    const state = asRecord(row?.state_payload);
    const items = Array.isArray(state.items) ? state.items : [];
    const selected = resolveProductLaunchTrackerSelection(items, {
      rowExpression: body.rowExpression,
      itemIds: body.itemIds,
      maxItems: 20,
    });

    return Response.json({
      ok: true,
      updatedAt: String(row?.updated_at ?? ""),
      rowCount: assignProductLaunchTrackerRowNumbers(items).length,
      selectedCount: selected.length,
      items: selected.map(({ trackerRowNumber, item }) =>
        summarizeItem(item, trackerRowNumber),
      ),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "상품출시진행관리 행을 불러오지 못했습니다.";
    const notFound = message.includes("찾을 수 없는");
    return Response.json(
      {
        ok: false,
        code: notFound ? "TRACKER_ROWS_NOT_FOUND" : "TRACKER_SELECTION_INVALID",
        message,
      },
      { status: notFound ? 404 : 400 },
    );
  }
}

function summarizeItem(item: Record<string, unknown>, trackerRowNumber: number) {
  const products = asRecord(item.shoplingProducts);
  const selfCodeBase = String(item.selfCodeBase ?? "").trim();
  const channels = CHANNELS.map((channel) => {
    const product = asRecord(products[channel.key]);
    return {
      ...channel,
      goodsKey: String(product.goodsKey ?? "").trim(),
      status: String(product.status ?? "not_started").trim(),
      error: String(product.error ?? "").trim(),
      registeredAt: product.registeredAt ?? null,
      ptnGoodsCd: `${selfCodeBase}${channel.suffix}`,
    };
  });
  const registeredCount = channels.filter((channel) => channel.goodsKey).length;
  const registrationComplete =
    channels.length === CHANNELS.length &&
    channels.every(
      (channel) => channel.goodsKey && channel.status === "success",
    );

  return {
    trackerRowNumber,
    id: String(item.id ?? "").trim(),
    modelNumber: String(item.modelNumber ?? "").trim(),
    productName: String(item.productName ?? "").trim(),
    workBatch: String(item.workBatch ?? "").trim(),
    barcode: String(item.barcode ?? "").trim(),
    selfCodeBase,
    channels,
    goodsKeys: channels.map((channel) => channel.goodsKey).filter(Boolean),
    registeredCount,
    registrationComplete,
    registrationPartial: registeredCount > 0 && !registrationComplete,
    pricePolicy: summarizePricePolicy(item.pricePolicy),
    stages: summarizeStages(item.stages),
  };
}

function summarizePricePolicy(value: unknown) {
  const source = asRecord(value);
  return {
    required: source.required === true,
    status: String(source.status ?? "").trim(),
    requestId: String(source.requestId ?? "").trim(),
    policyVersion: String(source.policyVersion ?? "").trim(),
    goodsKeyCount: Number(source.goodsKeyCount ?? 0) || 0,
    message: String(source.message ?? "").trim(),
    completedAt: source.completedAt ?? null,
    updatedAt: source.updatedAt ?? null,
  };
}

function summarizeStages(value: unknown) {
  const source = asRecord(value);
  return Object.fromEntries(
    Object.entries(source).map(([key, stage]) => {
      const item = asRecord(stage);
      return [
        key,
        {
          status: String(item.status ?? "미시작").trim(),
          completedAt: item.completedAt ?? null,
          note: String(item.note ?? "").trim(),
        },
      ];
    }),
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
