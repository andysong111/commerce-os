import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { withProductLaunchListSnapshot } from "@/lib/productLaunchTrackerListSnapshot";
import {
  getProductLaunchAdminConfig,
  readProductLaunchError,
  readProductLaunchStorageJson,
  readResponseJson,
  resolveProductLaunchIdentity,
  writeProductLaunchState,
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
const NORMALIZED_ITEM_TABLE = "product_launch_items";
const NORMALIZED_OPTION_TABLE = "product_launch_options";
const MIGRATION_KEY = "shoplingLocationCodeBackfill20260814V2";
const MIGRATION_VERSION = "2026-08-14-shopling-location-code-v2";
const EXPECTED_ITEMS_SHA256 = "56c15e73f74b0051dd2b49d4051f0116651b697c30acd671734897d01ea5bd3c";
const EXPECTED_MAPPING_ITEMS = 222;
const EXPECTED_MAPPING_OPTIONS = 393;
const EXPECTED_TRACKER_ITEMS = 346;
const EXPECTED_TRACKER_OPTIONS = 740;
const NORMALIZED_ITEM_PAGE_SIZE = 50;
const NORMALIZED_OPTION_PAGE_SIZE = 200;

type UnknownRecord = Record<string, unknown>;
type StoredRow = {
  state_payload?: unknown;
  updated_at?: unknown;
  schema_version?: unknown;
  owner_email?: unknown;
};
type MappingEnvelope = {
  version?: unknown;
  targetCount?: unknown;
  mappedItemCount?: unknown;
  mappedOptionCount?: unknown;
  approvedItemsSha256?: unknown;
  items?: unknown;
};
type LoadedContext = {
  config: { supabaseUrl: string; secretKey: string };
  identity: { userId: string; email: string };
  row: StoredRow;
  state: ProductLaunchTrackerState;
  stateSource: "normalized" | "canonical";
};
type LoadContextResult =
  | { ok: false; response: Response }
  | { ok: true; value: LoadedContext };

export async function GET(request: NextRequest) {
  const loaded = await loadContext(request);
  if (!loaded.ok) return loaded.response;
  const { state, row, stateSource } = loaded.value;
  const marker = asRecord(asRecord(state.serverMigrations)[MIGRATION_KEY]);
  const normalized = await normalizedStatus(
    loaded.value.config,
    loaded.value.identity.userId,
    row.updated_at,
  );
  return Response.json({
    ok: true,
    applied: text(marker.status) === "applied",
    appliedAt: nullableText(marker.appliedAt),
    version: text(marker.version) || MIGRATION_VERSION,
    report: marker.report ?? null,
    trackerItemCount: Array.isArray(state.items) ? state.items.length : 0,
    stateSource,
    normalized,
  });
}

export async function POST(request: NextRequest) {
  const loaded = await loadContext(request);
  if (!loaded.ok) return loaded.response;
  const { config, identity, row, state, stateSource } = loaded.value;

  let envelope: MappingEnvelope;
  try {
    const raw = await request.text();
    envelope = JSON.parse(raw) as MappingEnvelope;
  } catch {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_LOCATION_CODE_MAPPING_INVALID_JSON",
        message: "샵플링 위치코드 매핑 JSON이 올바르지 않습니다.",
      },
      { status: 400 },
    );
  }

  const validation = validateEnvelope(envelope, state);
  if (!validation.ok) {
    return Response.json(validation.body, { status: validation.status });
  }

  const marker = asRecord(asRecord(state.serverMigrations)[MIGRATION_KEY]);
  const apply = request.nextUrl.searchParams.get("apply") === "1";
  const prepared = prepareProductLaunchLocationCodeBackfill(
    state,
    validation.items,
    new Date().toISOString(),
  );

  if (prepared.report.hardConflictCount > 0) {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_LOCATION_CODE_BACKFILL_CONFLICT",
        message: "기존 B코드 또는 상품·옵션 식별값과 충돌해 자동 적용을 중단했습니다.",
        report: prepared.report,
        stateSource,
      },
      { status: 409 },
    );
  }

  if (!apply) {
    return Response.json({
      ok: true,
      dryRun: true,
      alreadyApplied: text(marker.status) === "applied",
      version: MIGRATION_VERSION,
      approvedItemsSha256: validation.itemsHash,
      stateSource,
      report: prepared.report,
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
        approvedItemsSha256: validation.itemsHash,
        source: "Shopling optPtnOptCd B-code + verified consensus mapping",
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
        code: "SHOPLING_LOCATION_CODE_CONCURRENT_UPDATE",
        message: "적용 중 다른 저장이 발생했습니다. 최신 상태로 다시 검증해 실행하세요.",
      },
      { status: 409 },
    );
  }

  let normalizedSync: UnknownRecord;
  try {
    const changedIds = validation.items.map((item) => text(item.itemId)).filter(Boolean);
    const sync = await syncProductLaunchNormalizedChangedItems(
      config,
      identity,
      nextState,
      saved.updated_at,
      changedIds,
    );
    const counts = await countProductLaunchNormalizedRows(config, identity.userId);
    const workspace = await readProductLaunchNormalizedWorkspace(config, identity.userId);
    normalizedSync = {
      ...sync,
      ...counts,
      fresh: isProductLaunchNormalizedFresh(workspace, saved.updated_at),
      readEnabled: workspace?.normalized_read_enabled === true,
    };
  } catch (error) {
    await setProductLaunchNormalizedReadEnabled(config, identity.userId, false).catch(() => null);
    normalizedSync = {
      synced: false,
      readEnabled: false,
      error: error instanceof Error ? error.message : "정규화 DB 동기화 실패",
    };
  }

  return Response.json({
    ok: true,
    applied: true,
    appliedAt,
    version: MIGRATION_VERSION,
    approvedItemsSha256: validation.itemsHash,
    stateSource,
    report: prepared.report,
    normalizedSync,
  });
}

async function loadContext(request: NextRequest): Promise<LoadContextResult> {
  const identity = await resolveProductLaunchIdentity(request, { requireSameOrigin: false });
  if (!identity.ok) {
    return { ok: false, response: Response.json(identity.body, { status: identity.status }) };
  }
  const config = getProductLaunchAdminConfig();
  if (!config.ok) {
    return { ok: false, response: Response.json(config.body, { status: config.status }) };
  }

  try {
    const row = await readCanonicalMetadata(config.value, identity.value.userId);
    if (!row) return stateNotFoundResponse();

    let state: ProductLaunchTrackerState | null = null;
    let stateSource: "normalized" | "canonical" = "normalized";
    let normalizedError = "";
    try {
      state = await readProductLaunchNormalizedState(
        config.value,
        identity.value.userId,
        row.updated_at,
      );
    } catch (error) {
      normalizedError = error instanceof Error ? error.message : "정규화 원장 읽기 실패";
    }

    if (!state) {
      stateSource = "canonical";
      try {
        const canonical = await readCanonicalState(config.value, identity.value.userId);
        if (!canonical || !isRecord(canonical.state_payload)) return stateNotFoundResponse();
        state = canonical.state_payload as ProductLaunchTrackerState;
        row.updated_at = canonical.updated_at ?? row.updated_at;
        row.schema_version = canonical.schema_version ?? row.schema_version;
        row.owner_email = canonical.owner_email ?? row.owner_email;
      } catch (error) {
        const canonicalError = error instanceof Error ? error.message : "기존 원장 읽기 실패";
        throw new Error(
          normalizedError
            ? `정규화 원장: ${normalizedError} · 기존 원장: ${canonicalError}`
            : canonicalError,
        );
      }
    }

    return {
      ok: true,
      value: {
        config: config.value,
        identity: identity.value,
        row,
        state,
        stateSource,
      },
    };
  } catch (error) {
    return {
      ok: false,
      response: Response.json(
        {
          ok: false,
          code: "SHOPLING_LOCATION_CODE_STATE_READ_FAILED",
          message: error instanceof Error ? error.message : "진행관리 저장본을 읽지 못했습니다.",
        },
        { status: 500 },
      ),
    };
  }
}

async function readCanonicalMetadata(
  config: { supabaseUrl: string; secretKey: string },
  ownerId: string,
) {
  const params = new URLSearchParams({
    select: "updated_at,schema_version,owner_email",
    owner_id: `eq.${ownerId}`,
    limit: "1",
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${TABLE_NAME}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
    {
      attempts: 4,
      timeoutMs: 20_000,
      retryDelaysMs: [1_000, 2_000, 4_000],
    },
  );
  return (Array.isArray(body) ? body[0] ?? null : null) as StoredRow | null;
}

async function readCanonicalState(
  config: { supabaseUrl: string; secretKey: string },
  ownerId: string,
) {
  const params = new URLSearchParams({
    select: "state_payload,updated_at,schema_version,owner_email",
    owner_id: `eq.${ownerId}`,
    limit: "1",
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${TABLE_NAME}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
    {
      attempts: 2,
      timeoutMs: 60_000,
      retryDelaysMs: [2_000],
    },
  );
  return (Array.isArray(body) ? body[0] ?? null : null) as StoredRow | null;
}

async function readProductLaunchNormalizedState(
  config: { supabaseUrl: string; secretKey: string },
  ownerId: string,
  canonicalUpdatedAt: unknown,
): Promise<ProductLaunchTrackerState | null> {
  const workspace = await readProductLaunchNormalizedWorkspace(config, ownerId);
  if (
    !workspace ||
    workspace.normalized_read_enabled !== true ||
    !isProductLaunchNormalizedFresh(workspace, canonicalUpdatedAt)
  ) {
    return null;
  }

  const itemParams = new URLSearchParams({
    select: "item_id,tracker_row_number,item_payload,updated_at,updated_by",
    owner_id: `eq.${ownerId}`,
    order: "item_id.asc",
  });
  const optionParams = new URLSearchParams({
    select: "item_id,option_id,option_index,option_payload",
    owner_id: `eq.${ownerId}`,
    order: "item_id.asc,option_index.asc",
  });

  const [itemRows, optionRows] = await Promise.all([
    readNormalizedRowsPaged(
      config,
      `${NORMALIZED_ITEM_TABLE}?${itemParams.toString()}`,
      NORMALIZED_ITEM_PAGE_SIZE,
      EXPECTED_TRACKER_ITEMS,
    ),
    readNormalizedRowsPaged(
      config,
      `${NORMALIZED_OPTION_TABLE}?${optionParams.toString()}`,
      NORMALIZED_OPTION_PAGE_SIZE,
      EXPECTED_TRACKER_OPTIONS,
    ),
  ]);

  if (
    itemRows.length !== EXPECTED_TRACKER_ITEMS ||
    optionRows.length !== EXPECTED_TRACKER_OPTIONS
  ) {
    throw new Error(
      `정규화 원장 행 수 불일치 items=${itemRows.length}/${EXPECTED_TRACKER_ITEMS} options=${optionRows.length}/${EXPECTED_TRACKER_OPTIONS}`,
    );
  }

  const optionsByItem = new Map<
    string,
    Array<{ optionIndex: number; payload: UnknownRecord }>
  >();
  for (const row of optionRows) {
    const itemId = text(row.item_id);
    if (!itemId) continue;
    const payload = cloneRecord(row.option_payload);
    if (!text(payload.id)) payload.id = text(row.option_id);
    const list = optionsByItem.get(itemId) ?? [];
    list.push({
      optionIndex: Math.max(0, Math.floor(Number(row.option_index) || 0)),
      payload,
    });
    optionsByItem.set(itemId, list);
  }

  const items = itemRows
    .map((row) => {
      const itemId = text(row.item_id);
      if (!itemId) return null;
      const payload = cloneRecord(row.item_payload);
      const options = (optionsByItem.get(itemId) ?? [])
        .sort((left, right) => left.optionIndex - right.optionIndex)
        .map((entry) => entry.payload);
      payload.id = itemId;
      payload.orderOptions = options;
      payload.options = options
        .map((option) => text(option.saleOption ?? option.value))
        .filter(Boolean);
      payload.updatedAt =
        text(payload.updatedAt) || normalizedTimestamp(row.updated_at) || "";
      payload.updatedBy = text(payload.updatedBy) || text(row.updated_by);
      if (!Number.isFinite(Number(payload.trackerRowNumber))) {
        payload.trackerRowNumber = Math.max(
          0,
          Math.floor(Number(row.tracker_row_number) || 0),
        );
      }
      return payload;
    })
    .filter((value): value is UnknownRecord => Boolean(value));

  items.sort((left, right) => {
    const rowDifference =
      Math.floor(Number(left.trackerRowNumber) || 0) -
      Math.floor(Number(right.trackerRowNumber) || 0);
    if (rowDifference) return rowDifference;
    return text(left.id).localeCompare(text(right.id), "ko-KR", {
      numeric: true,
      sensitivity: "base",
    });
  });

  const meta = cloneRecord(workspace.meta_payload);
  const state = {
    ...meta,
    schemaVersion: Math.max(3, Math.floor(Number(workspace.schema_version) || 3)),
    policy: cloneRecord(workspace.policy),
    items,
  } as ProductLaunchTrackerState;
  if (!state.sourceImportedAt && workspace.source_imported_at) {
    state.sourceImportedAt = workspace.source_imported_at;
  }
  return state;
}

async function readNormalizedRowsPaged(
  config: { supabaseUrl: string; secretKey: string },
  relativeUrl: string,
  pageSize: number,
  expectedCount: number,
) {
  const rows: UnknownRecord[] = [];
  for (let offset = 0; offset < expectedCount; offset += pageSize) {
    const end = Math.min(expectedCount - 1, offset + pageSize - 1);
    const { body } = await readProductLaunchStorageJson(
      `${config.supabaseUrl}/rest/v1/${relativeUrl}`,
      {
        headers: {
          ...createSupabaseAdminHeaders(config.secretKey),
          "Range-Unit": "items",
          Range: `${offset}-${end}`,
        },
        cache: "no-store",
      },
      {
        attempts: 4,
        timeoutMs: 30_000,
        retryDelaysMs: [1_000, 2_000, 4_000],
      },
    );
    const page = Array.isArray(body) ? body.filter(isRecord) : [];
    rows.push(...page);
    if (page.length < end - offset + 1) break;
  }
  return rows;
}

function stateNotFoundResponse() {
  return {
    ok: false as const,
    response: Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_STATE_NOT_FOUND",
        message: "상품출시진행관리 서버 저장본을 찾지 못했습니다.",
      },
      { status: 404 },
    ),
  } as const;
}

function validateEnvelope(envelope: MappingEnvelope, state: ProductLaunchTrackerState) {
  const items = Array.isArray(envelope.items)
    ? (envelope.items.filter(isRecord) as unknown as ProductLaunchLocationCodeMapping[])
    : [];
  const itemCount = items.length;
  const optionCount = items.reduce(
    (sum, item) => sum + (Array.isArray(item.orderOptions) ? item.orderOptions.length : 0),
    0,
  );
  const trackerItemCount = Array.isArray(state.items) ? state.items.length : 0;
  const itemsHash = sha256(stableJson(items));
  const declaredHash = text(envelope.approvedItemsSha256);

  if (
    text(envelope.version) !== "2026-08-14-current-launch-location-code-v2" ||
    Number(envelope.targetCount) !== EXPECTED_TRACKER_ITEMS ||
    Number(envelope.mappedItemCount) !== EXPECTED_MAPPING_ITEMS ||
    Number(envelope.mappedOptionCount) !== EXPECTED_MAPPING_OPTIONS ||
    itemCount !== EXPECTED_MAPPING_ITEMS ||
    optionCount !== EXPECTED_MAPPING_OPTIONS ||
    trackerItemCount !== EXPECTED_TRACKER_ITEMS ||
    declaredHash !== EXPECTED_ITEMS_SHA256 ||
    itemsHash !== EXPECTED_ITEMS_SHA256
  ) {
    return {
      ok: false as const,
      status: 409,
      body: {
        ok: false,
        code: "SHOPLING_LOCATION_CODE_MAPPING_NOT_APPROVED",
        message: "사전 검증된 샵플링 B코드 매핑과 일치하지 않아 적용을 중단했습니다.",
        expected: {
          trackerItemCount: EXPECTED_TRACKER_ITEMS,
          mappingItemCount: EXPECTED_MAPPING_ITEMS,
          mappingOptionCount: EXPECTED_MAPPING_OPTIONS,
          itemsSha256: EXPECTED_ITEMS_SHA256,
        },
        actual: { trackerItemCount, itemCount, optionCount, declaredHash, itemsHash },
      },
    };
  }
  return { ok: true as const, items, itemsHash };
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
  const params = new URLSearchParams({
    select: "updated_at,schema_version",
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
        schema_version: Math.max(3, Math.floor(Number(state.schemaVersion) || 3)),
        state_payload: state,
        updated_at: now,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    },
  );
  const body = await readResponseJson(response);
  if (!response.ok) throw new Error(readProductLaunchError(body, response.status));
  return Array.isArray(body) ? (body[0] as StoredRow | undefined) ?? null : null;
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
      readEnabled: workspace?.normalized_read_enabled === true,
      fresh: isProductLaunchNormalizedFresh(workspace, sourceUpdatedAt),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "정규화 DB 상태 확인 실패" };
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function cloneRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? (JSON.parse(JSON.stringify(value)) as UnknownRecord) : {};
}

function normalizedTimestamp(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
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
