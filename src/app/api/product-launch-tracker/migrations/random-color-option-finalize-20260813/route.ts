import { NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  getProductLaunchAdminConfig,
  readProductLaunchError,
  readProductLaunchState,
  readResponseJson,
  resolveProductLaunchIdentity,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";
import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";

export const runtime = "nodejs";

const TABLE_NAME = "product_launch_tracker_states";
const MIGRATION_KEY = "randomColorChinaOptionFinalize20260813V1";
const MIGRATION_VERSION = "2026-08-13-random-color-china-option-v1";
const TARGET_MODEL = "AAA483";
const TARGET_PRODUCT = "대형 에어 반달쿠션";
const TARGET_CHINA_OPTION = "抱枕-蓝色";

type UnknownRecord = Record<string, unknown>;
type StoredRow = {
  state_payload?: unknown;
  updated_at?: unknown;
};

export async function GET(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request, {
    requireSameOrigin: false,
  });
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  try {
    const row = (await readProductLaunchState(
      config.value,
      identity.value.userId,
    )) as StoredRow | null;
    if (!row || !isRecord(row.state_payload)) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_STATE_NOT_FOUND",
          message: "상품출시진행관리 서버 저장본을 찾지 못했습니다.",
        },
        { status: 404 },
      );
    }

    const currentState = row.state_payload as ProductLaunchTrackerState;
    const marker = asRecord(asRecord(currentState.serverMigrations)[MIGRATION_KEY]);
    if (text(marker.status) === "applied") {
      return Response.json({
        ok: true,
        alreadyApplied: true,
        appliedAt: text(marker.appliedAt),
        report: marker.report ?? null,
      });
    }

    const prepared = prepareMigration(currentState);
    const apply = request.nextUrl.searchParams.get("apply") === "1";
    if (!apply) {
      return Response.json({ ok: true, dryRun: true, report: prepared.report });
    }

    if (prepared.report.matchedItems !== 1) {
      return Response.json(
        {
          ok: false,
          code: "RANDOM_COLOR_TARGET_NOT_UNIQUE",
          message: "AAA483 대형 에어 반달쿠션 대상이 정확히 1건이 아니어서 적용을 중단했습니다.",
          report: prepared.report,
        },
        { status: 409 },
      );
    }

    const appliedAt = new Date().toISOString();
    const nextState: ProductLaunchTrackerState = {
      ...prepared.state,
      savedAt: appliedAt,
      serverMigrations: {
        ...asRecord(prepared.state.serverMigrations),
        [MIGRATION_KEY]: {
          status: "applied",
          version: MIGRATION_VERSION,
          appliedAt,
          rule: "색상·디자인만 다른 랜덤 옵션은 임의 옵션 1개 선택",
          selectedChinaOption: TARGET_CHINA_OPTION,
          report: prepared.report,
        },
      },
    };

    const saved = await conditionalWriteState(
      config.value,
      identity.value,
      nextState,
      nullableText(row.updated_at),
    );
    if (!saved) {
      return Response.json(
        {
          ok: false,
          code: "RANDOM_COLOR_OPTION_CONCURRENT_UPDATE",
          message: "적용 중 다른 저장이 발생했습니다. 다시 실행하세요.",
        },
        { status: 409 },
      );
    }

    return Response.json({
      ok: true,
      applied: true,
      appliedAt,
      report: prepared.report,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "RANDOM_COLOR_OPTION_FINALIZE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "랜덤 색상 중국옵션 최종 반영에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}

function prepareMigration(stateInput: ProductLaunchTrackerState) {
  const state = cloneJson(stateInput);
  const items = Array.isArray(state.items) ? state.items.filter(isRecord) : [];
  let matchedItems = 0;
  let matchedOptions = 0;
  let changedItems = 0;
  let changedOptions = 0;
  let preservedExistingOptions = 0;
  const matchedItemIds: string[] = [];

  state.items = items.map((item) => {
    if (
      normalizeModel(item.modelNumber) !== TARGET_MODEL ||
      normalizeProduct(item.productName) !== normalizeProduct(TARGET_PRODUCT)
    ) {
      return item;
    }

    matchedItems += 1;
    matchedItemIds.push(text(item.id));
    const currentOptions = Array.isArray(item.orderOptions)
      ? item.orderOptions.map((option) => (isRecord(option) ? { ...option } : {}))
      : [];
    let itemChanged = false;
    const nextOptions = currentOptions.map((option) => {
      const saleOption = text(option.saleOption ?? option.value);
      if (!/랜덤/.test(saleOption)) return option;
      matchedOptions += 1;
      if (text(option.chinaOption)) {
        preservedExistingOptions += 1;
        return option;
      }
      itemChanged = true;
      changedOptions += 1;
      return { ...option, chinaOption: TARGET_CHINA_OPTION };
    });

    if (!itemChanged) return item;
    changedItems += 1;
    const now = new Date().toISOString();
    return {
      ...item,
      orderOptions: nextOptions,
      updatedAt: now,
      updatedBy: "승준",
    };
  });

  return {
    state,
    report: {
      version: MIGRATION_VERSION,
      targetModel: TARGET_MODEL,
      targetProduct: TARGET_PRODUCT,
      selectedChinaOption: TARGET_CHINA_OPTION,
      matchedItems,
      matchedOptions,
      changedItems,
      changedOptions,
      preservedExistingOptions,
      matchedItemIds,
    },
  };
}

async function conditionalWriteState(
  config: { supabaseUrl: string; secretKey: string },
  identity: { userId: string; email: string },
  state: ProductLaunchTrackerState,
  previousUpdatedAt: string | null,
) {
  if (!previousUpdatedAt) {
    return (await writeProductLaunchState(
      config,
      identity,
      state as Record<string, unknown>,
    )) as StoredRow;
  }

  const now = new Date().toISOString();
  const schemaVersion = Math.max(3, Math.floor(Number(state.schemaVersion) || 3));
  const params = new URLSearchParams({
    owner_id: `eq.${identity.userId}`,
    updated_at: `eq.${previousUpdatedAt}`,
  });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${TABLE_NAME}?${params.toString()}`,
    {
      method: "PATCH",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        owner_email: identity.email,
        schema_version: schemaVersion,
        state_payload: state,
        updated_at: now,
      }),
      cache: "no-store",
    },
  );
  const body = await readResponseJson(response);
  if (!response.ok) {
    throw new Error(readProductLaunchError(body, response.status));
  }
  return Array.isArray(body) ? (body[0] as StoredRow | undefined) ?? null : null;
}

function normalizeModel(value: unknown) {
  return text(value).normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

function normalizeProduct(value: unknown) {
  return text(value).normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function nullableText(value: unknown) {
  const result = text(value);
  return result || null;
}
