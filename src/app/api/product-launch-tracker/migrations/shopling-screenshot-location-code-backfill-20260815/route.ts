import { NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { withProductLaunchListSnapshot } from "@/lib/productLaunchTrackerListSnapshot";
import {
  getProductLaunchAdminConfig,
  readProductLaunchError,
  readProductLaunchStorageJson,
  readResponseJson,
  resolveProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";
import {
  countProductLaunchNormalizedRows,
  isProductLaunchNormalizedFresh,
  readProductLaunchNormalizedWorkspace,
  setProductLaunchNormalizedReadEnabled,
  syncProductLaunchNormalizedChangedItems,
} from "@/lib/productLaunchTrackerNormalizedStore";
import {
  prepareProductLaunchLocationCodeBackfill,
  type ProductLaunchLocationCodeMapping,
} from "@/lib/productLaunchTrackerLocationCodeBackfill";
import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";

export const runtime = "nodejs";
export const maxDuration = 300;

const TABLE_NAME = "product_launch_tracker_states";
const MIGRATION_KEY = "shoplingScreenshotLocationCodeBackfill20260815V1";
const MIGRATION_VERSION = "2026-08-15-shopling-screenshot-location-code-v1";
const EXPECTED_TRACKER_ITEMS = 346;
const EXPECTED_TRACKER_OPTIONS = 740;
const EXPECTED_MAPPING_ITEMS = 5;
const EXPECTED_MAPPING_OPTIONS = 9;

type UnknownRecord = Record<string, unknown>;
type StoredRow = {
  state_payload?: unknown;
  updated_at?: unknown;
  schema_version?: unknown;
};

const MAPPINGS: ProductLaunchLocationCodeMapping[] = [
  {
    itemId: "17aba3b0-5f9b-4a9c-9722-d592f80a78ba",
    expectedModelNumber: "AAA095",
    expectedProductName: "비듬제거 촘촘빗",
    barcode: "BBA7-2",
    warehouseLocation: "BBA7-2",
    method: "user_shopling_screenshot_exact_product_keywords",
    orderOptions: [
      {
        optionId: "stock-AAA095-1",
        expectedSaleOption: "단품",
        barcode: "BBA7-2",
      },
    ],
  },
  {
    itemId: "1c987a02-2c46-44e0-a8c1-931750b650c4",
    expectedModelNumber: "AAA126",
    expectedProductName: "접이식 아연 재단가위",
    method: "user_shopling_screenshot_split_product_name_option",
    orderOptions: [
      {
        optionId: "stock-AAA126-2",
        expectedSaleOption: "골드",
        barcode: "BCA6-2",
      },
      {
        optionId: "stock-AAA126-3",
        expectedSaleOption: "실버",
        barcode: "BCA6-3",
      },
      {
        optionId: "stock-AAA126-4",
        expectedSaleOption: "로즈골드",
        barcode: "BCA6-1",
      },
    ],
  },
  {
    itemId: "342353dd-f23f-4baa-9ce1-cf5797fb0e6b",
    expectedModelNumber: "AAA128",
    expectedProductName: "방수 사하라캡",
    method: "user_shopling_screenshot_split_product_name_option",
    orderOptions: [
      {
        optionId: "stock-AAA128-6",
        expectedSaleOption: "네이비블루",
        barcode: "BGE3-2",
      },
    ],
  },
  {
    itemId: "02a37104-beb2-439b-874f-fe49ad6e5ad1",
    expectedModelNumber: "AAA168",
    expectedProductName: "방한방수터치장갑",
    method: "user_shopling_screenshot_split_product_name_option",
    orderOptions: [
      {
        optionId: "stock-AAA168-1",
        expectedSaleOption: "남성용블랙",
        barcode: "BGC1-1",
      },
      {
        optionId: "stock-AAA168-3",
        expectedSaleOption: "여성용그레이",
        barcode: "BGC1-3",
      },
    ],
  },
  {
    itemId: "90eec3f3-1efb-4e5d-a2cd-52ca103b4e3d",
    expectedModelNumber: "AAA186",
    expectedProductName: "실리콘 오븐장갑",
    method: "user_shopling_screenshot_split_product_name_option",
    orderOptions: [
      {
        optionId: "stock-AAA186-3",
        expectedSaleOption: "블랙1P",
        barcode: "BCB6-2",
      },
      {
        optionId: "stock-AAA186-4",
        expectedSaleOption: "그레이1P",
        barcode: "BCB6-3",
      },
    ],
  },
];

export async function GET(request: NextRequest) {
  const loaded = await loadContext(request);
  if (!loaded.ok) return loaded.response;

  const { config, identity, row, state } = loaded.value;
  const marker = asRecord(asRecord(state.serverMigrations)[MIGRATION_KEY]);
  return Response.json({
    ok: true,
    applied: text(marker.status) === "applied",
    appliedAt: nullableText(marker.appliedAt),
    version: text(marker.version) || MIGRATION_VERSION,
    report: marker.report ?? null,
    expectedMappingItems: EXPECTED_MAPPING_ITEMS,
    expectedMappingOptions: EXPECTED_MAPPING_OPTIONS,
    trackerItemCount: Array.isArray(state.items) ? state.items.length : 0,
    trackerOptionCount: countTrackerOptions(state),
    normalized: await normalizedStatus(
      config,
      identity.userId,
      row.updated_at,
    ),
  });
}

export async function POST(request: NextRequest) {
  const loaded = await loadContext(request);
  if (!loaded.ok) return loaded.response;

  const { config, identity, row, state } = loaded.value;
  const marker = asRecord(asRecord(state.serverMigrations)[MIGRATION_KEY]);
  if (text(marker.status) === "applied") {
    return Response.json({
      ok: true,
      applied: true,
      alreadyApplied: true,
      appliedAt: nullableText(marker.appliedAt),
      version: MIGRATION_VERSION,
      report: marker.report ?? null,
      normalized: await normalizedStatus(
        config,
        identity.userId,
        row.updated_at,
      ),
    });
  }

  const trackerItemCount = Array.isArray(state.items) ? state.items.length : 0;
  const trackerOptionCount = countTrackerOptions(state);
  if (
    trackerItemCount !== EXPECTED_TRACKER_ITEMS ||
    trackerOptionCount !== EXPECTED_TRACKER_OPTIONS ||
    MAPPINGS.length !== EXPECTED_MAPPING_ITEMS ||
    countMappingOptions(MAPPINGS) !== EXPECTED_MAPPING_OPTIONS
  ) {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_SCREENSHOT_SCOPE_CHANGED",
        message:
          "상품출시진행관리 상품·옵션 수 또는 승인된 스크린샷 매핑 범위가 달라 적용을 중단했습니다.",
        expected: {
          trackerItemCount: EXPECTED_TRACKER_ITEMS,
          trackerOptionCount: EXPECTED_TRACKER_OPTIONS,
          mappingItemCount: EXPECTED_MAPPING_ITEMS,
          mappingOptionCount: EXPECTED_MAPPING_OPTIONS,
        },
        actual: {
          trackerItemCount,
          trackerOptionCount,
          mappingItemCount: MAPPINGS.length,
          mappingOptionCount: countMappingOptions(MAPPINGS),
        },
      },
      { status: 409 },
    );
  }

  const prepared = prepareProductLaunchLocationCodeBackfill(
    state,
    MAPPINGS,
    new Date().toISOString(),
  );
  if (
    prepared.report.mappingCount !== EXPECTED_MAPPING_ITEMS ||
    prepared.report.mappingOptionCount !== EXPECTED_MAPPING_OPTIONS ||
    prepared.report.matchedItems !== EXPECTED_MAPPING_ITEMS ||
    prepared.report.hardConflictCount > 0
  ) {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_SCREENSHOT_MAPPING_CONFLICT",
        message:
          "스크린샷 매핑과 현재 상품·옵션 식별값 또는 기존 B코드가 충돌해 적용을 중단했습니다.",
        report: prepared.report,
      },
      { status: 409 },
    );
  }

  const apply = request.nextUrl.searchParams.get("apply") === "1";
  if (!apply) {
    return Response.json({
      ok: true,
      dryRun: true,
      alreadyApplied: false,
      version: MIGRATION_VERSION,
      report: prepared.report,
      mappings: mappingSummary(),
    });
  }

  const appliedAt = new Date().toISOString();
  const nextState = withProductLaunchListSnapshot({
    ...prepared.state,
    savedAt: appliedAt,
    serverMigrations: {
      ...asRecord(prepared.state.serverMigrations),
      [MIGRATION_KEY]: {
        status: "applied",
        version: MIGRATION_VERSION,
        appliedAt,
        source:
          "User-provided Shopling screenshots; model number + split product-name option matching; optPtnOptCd only",
        mappedItemCount: EXPECTED_MAPPING_ITEMS,
        mappedOptionCount: EXPECTED_MAPPING_OPTIONS,
        mappings: mappingSummary(),
        report: prepared.report,
      },
    },
  } as ProductLaunchTrackerState);

  const saved = await conditionalWriteState(
    config,
    identity,
    nextState,
    nullableText(row.updated_at),
  );
  if (!saved) {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_SCREENSHOT_CONCURRENT_UPDATE",
        message:
          "스크린샷 B코드 적용 중 다른 저장이 발생했습니다. 최신 상태로 다시 실행하세요.",
      },
      { status: 409 },
    );
  }

  let normalizedSync: UnknownRecord;
  try {
    const changedIds = MAPPINGS.map((item) => text(item.itemId)).filter(Boolean);
    const sync = await syncProductLaunchNormalizedChangedItems(
      config,
      identity,
      nextState,
      saved.updated_at,
      changedIds,
    );
    const counts = await countProductLaunchNormalizedRows(
      config,
      identity.userId,
    );
    const workspace = await readProductLaunchNormalizedWorkspace(
      config,
      identity.userId,
    );
    normalizedSync = {
      ...sync,
      ...counts,
      fresh: isProductLaunchNormalizedFresh(workspace, saved.updated_at),
      readEnabled: workspace?.normalized_read_enabled === true,
    };
  } catch (error) {
    await setProductLaunchNormalizedReadEnabled(
      config,
      identity.userId,
      false,
    ).catch(() => null);
    normalizedSync = {
      synced: false,
      readEnabled: false,
      error:
        error instanceof Error ? error.message : "정규화 DB 동기화 실패",
    };
  }

  return Response.json({
    ok: true,
    applied: true,
    appliedAt,
    version: MIGRATION_VERSION,
    report: prepared.report,
    mappings: mappingSummary(),
    normalizedSync,
  });
}

async function loadContext(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request, {
    requireSameOrigin: false,
  });
  if (!identity.ok) {
    return {
      ok: false as const,
      response: Response.json(identity.body, { status: identity.status }),
    };
  }

  const config = getProductLaunchAdminConfig();
  if (!config.ok) {
    return {
      ok: false as const,
      response: Response.json(config.body, { status: config.status }),
    };
  }

  try {
    const params = new URLSearchParams({
      select: "state_payload,updated_at,schema_version,owner_email",
      owner_id: `eq.${identity.value.userId}`,
      limit: "1",
    });
    const { body } = await readProductLaunchStorageJson(
      `${config.value.supabaseUrl}/rest/v1/${TABLE_NAME}?${params.toString()}`,
      {
        headers: createSupabaseAdminHeaders(config.value.secretKey),
        cache: "no-store",
      },
      {
        attempts: 4,
        timeoutMs: 60_000,
        retryDelaysMs: [2_000, 5_000, 10_000],
      },
    );
    const row = (Array.isArray(body) ? body[0] ?? null : null) as
      | StoredRow
      | null;
    if (!row || !isRecord(row.state_payload)) {
      return {
        ok: false as const,
        response: Response.json(
          {
            ok: false,
            code: "PRODUCT_LAUNCH_STATE_NOT_FOUND",
            message: "상품출시진행관리 원본 저장본을 찾지 못했습니다.",
          },
          { status: 404 },
        ),
      };
    }

    return {
      ok: true as const,
      value: {
        config: config.value,
        identity: identity.value,
        row,
        state: row.state_payload as ProductLaunchTrackerState,
      },
    };
  } catch (error) {
    return {
      ok: false as const,
      response: Response.json(
        {
          ok: false,
          code: "SHOPLING_SCREENSHOT_STATE_READ_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "상품출시진행관리 저장본을 읽지 못했습니다.",
        },
        { status: 500 },
      ),
    };
  }
}

async function conditionalWriteState(
  config: { supabaseUrl: string; secretKey: string },
  identity: { userId: string; email: string },
  state: ProductLaunchTrackerState,
  previousUpdatedAt: string | null,
) {
  const now = new Date().toISOString();
  const params = new URLSearchParams({
    owner_id: `eq.${identity.userId}`,
  });
  if (previousUpdatedAt) {
    params.set("updated_at", `eq.${previousUpdatedAt}`);
  }

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
        schema_version: Math.max(
          3,
          Math.floor(Number(state.schemaVersion) || 3),
        ),
        state_payload: state,
        updated_at: now,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(180_000),
    },
  );
  const body = await readResponseJson(response);
  if (!response.ok) {
    throw new Error(readProductLaunchError(body, response.status));
  }
  return Array.isArray(body)
    ? ((body[0] as StoredRow | undefined) ?? null)
    : null;
}

async function normalizedStatus(
  config: { supabaseUrl: string; secretKey: string },
  ownerId: string,
  sourceUpdatedAt: unknown,
) {
  try {
    const [counts, workspace] = await Promise.all([
      countProductLaunchNormalizedRows(config, ownerId),
      readProductLaunchNormalizedWorkspace(config, ownerId),
    ]);
    return {
      ...counts,
      expectedItemCount: EXPECTED_TRACKER_ITEMS,
      expectedOptionCount: EXPECTED_TRACKER_OPTIONS,
      readEnabled: workspace?.normalized_read_enabled === true,
      fresh: isProductLaunchNormalizedFresh(workspace, sourceUpdatedAt),
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "정규화 DB 상태 확인 실패",
    };
  }
}

function mappingSummary() {
  return MAPPINGS.map((mapping) => ({
    itemId: mapping.itemId,
    modelNumber: mapping.expectedModelNumber,
    productName: mapping.expectedProductName,
    options: mapping.orderOptions.map((option) => ({
      optionId: option.optionId,
      saleOption: option.expectedSaleOption,
      barcode: option.barcode,
    })),
  }));
}

function countTrackerOptions(state: ProductLaunchTrackerState) {
  return (Array.isArray(state.items) ? state.items : []).reduce(
    (sum, item) =>
      sum +
      (isRecord(item) && Array.isArray(item.orderOptions)
        ? item.orderOptions.length
        : 0),
    0,
  );
}

function countMappingOptions(mappings: ProductLaunchLocationCodeMapping[]) {
  return mappings.reduce(
    (sum, item) =>
      sum + (Array.isArray(item.orderOptions) ? item.orderOptions.length : 0),
    0,
  );
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
