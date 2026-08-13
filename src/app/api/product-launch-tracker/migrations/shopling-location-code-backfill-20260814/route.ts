import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
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
  syncProductLaunchNormalizedFull,
} from "@/lib/productLaunchTrackerNormalizedStore";
import {
  prepareProductLaunchLocationCodeBackfill,
  type ProductLaunchLocationCodeMapping,
} from "@/lib/productLaunchTrackerLocationCodeBackfill";
import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";

export const runtime = "nodejs";
export const maxDuration = 300;

const TABLE_NAME = "product_launch_tracker_states";
const MIGRATION_KEY = "shoplingLocationCodeBackfill20260814V2";
const MIGRATION_VERSION = "2026-08-14-shopling-location-code-v2";
const EXPECTED_ITEMS_SHA256 = "56c15e73f74b0051dd2b49d4051f0116651b697c30acd671734897d01ea5bd3c";
const EXPECTED_MAPPING_ITEMS = 222;
const EXPECTED_MAPPING_OPTIONS = 393;
const EXPECTED_TRACKER_ITEMS = 346;

type UnknownRecord = Record<string, unknown>;
type StoredRow = {
  state_payload?: unknown;
  updated_at?: unknown;
  schema_version?: unknown;
};
type MappingEnvelope = {
  version?: unknown;
  targetCount?: unknown;
  mappedItemCount?: unknown;
  mappedOptionCount?: unknown;
  approvedItemsSha256?: unknown;
  items?: unknown;
};

export async function GET(request: NextRequest) {
  const loaded = await loadContext(request);
  if (loaded.response) return loaded.response;
  const { state, row } = loaded.value;
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
    normalized,
  });
}

export async function POST(request: NextRequest) {
  const loaded = await loadContext(request);
  if (loaded.response) return loaded.response;
  const { config, identity, row, state } = loaded.value;

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
      report: prepared.report,
    });
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
        approvedItemsSha256: validation.itemsHash,
        source: "Shopling optPtnOptCd B-code + verified consensus mapping",
        report: prepared.report,
      },
    },
  };

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
    const sync = await syncProductLaunchNormalizedFull(
      config,
      identity,
      nextState,
      saved.updated_at,
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
    report: prepared.report,
    normalizedSync,
  });
}

async function loadContext(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request, { requireSameOrigin: false });
  if (!identity.ok) {
    return { response: Response.json(identity.body, { status: identity.status }) } as const;
  }
  const config = getProductLaunchAdminConfig();
  if (!config.ok) {
    return { response: Response.json(config.body, { status: config.status }) } as const;
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
        attempts: 2,
        timeoutMs: 60_000,
        retryDelaysMs: [2_000],
      },
    );
    const row = (Array.isArray(body) ? body[0] ?? null : null) as StoredRow | null;
    if (!row || !isRecord(row.state_payload)) {
      return {
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
    return {
      value: {
        config: config.value,
        identity: identity.value,
        row,
        state: row.state_payload as ProductLaunchTrackerState,
      },
    } as const;
  } catch (error) {
    return {
      response: Response.json(
        {
          ok: false,
          code: "SHOPLING_LOCATION_CODE_STATE_READ_FAILED",
          message: error instanceof Error ? error.message : "진행관리 저장본을 읽지 못했습니다.",
        },
        { status: 500 },
      ),
    } as const;
  }
}

function validateEnvelope(envelope: MappingEnvelope, state: ProductLaunchTrackerState) {
  const items = Array.isArray(envelope.items)
    ? envelope.items.filter(isRecord) as unknown as ProductLaunchLocationCodeMapping[]
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
