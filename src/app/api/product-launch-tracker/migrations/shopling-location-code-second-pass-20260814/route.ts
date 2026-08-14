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
const MIGRATION_KEY = "shoplingLocationCodeSecondPass20260814V1";
const MIGRATION_VERSION = "2026-08-14-unresolved-124-self-code-v1";
const EXPECTED_TRACKER_ITEMS = 346;
const EXPECTED_TRACKER_OPTIONS = 740;
const EXPECTED_TARGET_ITEMS = 124;
const EXPECTED_TARGET_OPTIONS = 347;
const EXPECTED_TARGET_MANIFEST_SHA256 =
  "0e98ce202a3f1cc4a75867ce5f2ae232485322b20259e883ef27e032dfdfce07";

type UnknownRecord = Record<string, unknown>;
type StoredRow = {
  state_payload?: unknown;
  updated_at?: unknown;
  schema_version?: unknown;
};
type TargetManifestEntry = {
  itemId: string;
  expectedModelNumber: string;
  expectedProductName: string;
  orderOptions: Array<{
    optionId: string;
    expectedSaleOption: string;
  }>;
};
type MappingEnvelope = {
  version?: unknown;
  unresolvedTargetCount?: unknown;
  unresolvedTargetOptionCount?: unknown;
  targetManifestSha256?: unknown;
  targetManifest?: unknown;
  mappedItemCount?: unknown;
  mappedOptionCount?: unknown;
  completeMappedItemCount?: unknown;
  partialMappedItemCount?: unknown;
  itemsSha256?: unknown;
  items?: unknown;
};

export async function GET(request: NextRequest) {
  const loaded = await loadContext(request);
  if (!loaded.ok) return loaded.response;
  const { config, identity, row, state } = loaded.value;
  const marker = asRecord(asRecord(state.serverMigrations)[MIGRATION_KEY]);
  const normalized = await normalizedStatus(
    config,
    identity.userId,
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
  if (!loaded.ok) return loaded.response;
  const { config, identity, row, state } = loaded.value;

  let envelope: MappingEnvelope;
  try {
    envelope = JSON.parse(await request.text()) as MappingEnvelope;
  } catch {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_SECOND_PASS_INVALID_JSON",
        message: "2차 샵플링 위치코드 매핑 JSON이 올바르지 않습니다.",
      },
      { status: 400 },
    );
  }

  const validation = validateEnvelope(envelope, state);
  if (!validation.ok) {
    return Response.json(validation.body, { status: validation.status });
  }

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

  const prepared = prepareProductLaunchLocationCodeBackfill(
    state,
    validation.items,
    new Date().toISOString(),
  );
  if (prepared.report.hardConflictCount > 0) {
    return Response.json(
      {
        ok: false,
        code: "SHOPLING_SECOND_PASS_CONFLICT",
        message:
          "상품·옵션 식별값 또는 기존 B코드와 충돌해 2차 자동 적용을 중단했습니다.",
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
      targetManifestSha256: validation.targetManifestHash,
      itemsSha256: validation.itemsHash,
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
        source:
          "Live Shopling direct model lookup; optPtnOptCd only; blank goods_key accepted",
        targetManifestSha256: validation.targetManifestHash,
        itemsSha256: validation.itemsHash,
        mappedItemCount: validation.items.length,
        mappedOptionCount: validation.items.reduce(
          (sum, item) =>
            sum +
            (Array.isArray(item.orderOptions) ? item.orderOptions.length : 0),
          0,
        ),
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
        code: "SHOPLING_SECOND_PASS_CONCURRENT_UPDATE",
        message:
          "2차 B코드 적용 중 다른 저장이 발생했습니다. 최신 상태로 다시 실행하세요.",
      },
      { status: 409 },
    );
  }

  let normalizedSync: UnknownRecord;
  try {
    const changedIds = validation.items
      .map((item) => text(item.itemId))
      .filter(Boolean);
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
    targetManifestSha256: validation.targetManifestHash,
    itemsSha256: validation.itemsHash,
    report: prepared.report,
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
          code: "SHOPLING_SECOND_PASS_STATE_READ_FAILED",
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

function validateEnvelope(
  envelope: MappingEnvelope,
  state: ProductLaunchTrackerState,
) {
  const manifest = Array.isArray(envelope.targetManifest)
    ? (envelope.targetManifest.filter(isRecord) as unknown as TargetManifestEntry[])
    : [];
  const items = Array.isArray(envelope.items)
    ? (envelope.items.filter(isRecord) as unknown as ProductLaunchLocationCodeMapping[])
    : [];
  const manifestOptionCount = manifest.reduce(
    (sum, item) =>
      sum + (Array.isArray(item.orderOptions) ? item.orderOptions.length : 0),
    0,
  );
  const mappedOptionCount = items.reduce(
    (sum, item) =>
      sum + (Array.isArray(item.orderOptions) ? item.orderOptions.length : 0),
    0,
  );
  const targetManifestHash = sha256(stableJson(manifest));
  const itemsHash = sha256(stableJson(items));
  const trackerItems = Array.isArray(state.items)
    ? state.items.filter(isRecord)
    : [];
  const trackerItemCount = trackerItems.length;

  const basicMismatch =
    text(envelope.version) !== MIGRATION_VERSION ||
    Number(envelope.unresolvedTargetCount) !== EXPECTED_TARGET_ITEMS ||
    Number(envelope.unresolvedTargetOptionCount) !== EXPECTED_TARGET_OPTIONS ||
    manifest.length !== EXPECTED_TARGET_ITEMS ||
    manifestOptionCount !== EXPECTED_TARGET_OPTIONS ||
    text(envelope.targetManifestSha256) !==
      EXPECTED_TARGET_MANIFEST_SHA256 ||
    targetManifestHash !== EXPECTED_TARGET_MANIFEST_SHA256 ||
    Number(envelope.mappedItemCount) !== items.length ||
    Number(envelope.mappedOptionCount) !== mappedOptionCount ||
    !items.length ||
    !mappedOptionCount ||
    text(envelope.itemsSha256) !== itemsHash ||
    trackerItemCount !== EXPECTED_TRACKER_ITEMS;

  if (basicMismatch) {
    return {
      ok: false as const,
      status: 409,
      body: {
        ok: false,
        code: "SHOPLING_SECOND_PASS_MAPPING_NOT_APPROVED",
        message:
          "124개 미확정 상품 원본 또는 실시간 B코드 결과가 검증 기준과 일치하지 않습니다.",
        expected: {
          trackerItemCount: EXPECTED_TRACKER_ITEMS,
          targetItemCount: EXPECTED_TARGET_ITEMS,
          targetOptionCount: EXPECTED_TARGET_OPTIONS,
          targetManifestSha256: EXPECTED_TARGET_MANIFEST_SHA256,
        },
        actual: {
          trackerItemCount,
          manifestItemCount: manifest.length,
          manifestOptionCount,
          targetManifestHash,
          mappedItemCount: items.length,
          mappedOptionCount,
          itemsHash,
        },
      },
    };
  }

  const manifestById = new Map(
    manifest.map((entry) => [text(entry.itemId), entry] as const),
  );
  const trackerById = new Map(
    trackerItems.map((entry) => [text(entry.id), entry] as const),
  );
  const manifestConflicts: UnknownRecord[] = [];

  for (const entry of manifest) {
    const itemId = text(entry.itemId);
    const current = trackerById.get(itemId);
    if (
      !current ||
      normalizeModel(current.modelNumber) !==
        normalizeModel(entry.expectedModelNumber) ||
      normalizeProduct(current.productName) !==
        normalizeProduct(entry.expectedProductName)
    ) {
      manifestConflicts.push({
        itemId,
        reason: "item_identity_mismatch",
      });
      continue;
    }
    const currentOptions = Array.isArray(current.orderOptions)
      ? current.orderOptions.filter(isRecord)
      : [];
    const currentById = new Map(
      currentOptions.map((option, index) => [
        text(option.id) || `option-${index + 1}`,
        option,
      ]),
    );
    for (const option of entry.orderOptions ?? []) {
      const currentOption = currentById.get(text(option.optionId));
      if (
        !currentOption ||
        normalizeOption(
          currentOption.saleOption ?? currentOption.value,
        ) !== normalizeOption(option.expectedSaleOption)
      ) {
        manifestConflicts.push({
          itemId,
          optionId: text(option.optionId),
          reason: "option_identity_mismatch",
        });
      }
    }
  }

  const duplicateItemIds = findDuplicates(items.map((item) => text(item.itemId)));
  const mappingScopeConflicts: UnknownRecord[] = [];
  for (const mapping of items) {
    const manifestItem = manifestById.get(text(mapping.itemId));
    if (!manifestItem) {
      mappingScopeConflicts.push({
        itemId: text(mapping.itemId),
        reason: "item_not_in_unresolved_manifest",
      });
      continue;
    }
    const manifestOptions = new Map(
      (manifestItem.orderOptions ?? []).map((option) => [
        text(option.optionId),
        option,
      ]),
    );
    for (const option of mapping.orderOptions ?? []) {
      const expected = manifestOptions.get(text(option.optionId));
      if (
        !expected ||
        normalizeOption(expected.expectedSaleOption) !==
          normalizeOption(option.expectedSaleOption)
      ) {
        mappingScopeConflicts.push({
          itemId: text(mapping.itemId),
          optionId: text(option.optionId),
          reason: "option_not_in_unresolved_manifest",
        });
      }
    }
  }

  if (
    manifestConflicts.length ||
    duplicateItemIds.length ||
    mappingScopeConflicts.length
  ) {
    return {
      ok: false as const,
      status: 409,
      body: {
        ok: false,
        code: "SHOPLING_SECOND_PASS_TARGET_CHANGED",
        message:
          "124개 대상 상품 또는 옵션 구성이 변경되어 2차 적용을 중단했습니다.",
        manifestConflicts,
        duplicateItemIds,
        mappingScopeConflicts,
      },
    };
  }

  return {
    ok: true as const,
    items,
    targetManifestHash,
    itemsHash,
  };
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
      fresh: isProductLaunchNormalizedFresh(
        workspace,
        sourceUpdatedAt,
      ),
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson(value[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function findDuplicates(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value);
}

function normalizeModel(value: unknown) {
  return text(value)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\s+/g, "");
}

function normalizeProduct(value: unknown) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/g, "");
}

function normalizeOption(value: unknown) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(
      /(색상)?\s*(랜덤|임의)\s*(색상)?\s*(발송)?/g,
      "랜덤",
    )
    .replace(/[^0-9a-z가-힣]+/g, "");
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
