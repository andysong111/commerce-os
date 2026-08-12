import { NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD,
  withProductLaunchListSnapshot,
} from "@/lib/productLaunchTrackerListSnapshot";
import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";
import {
  getProductLaunchAdminConfig,
  readProductLaunchError,
  readProductLaunchState,
  readResponseJson,
  resolveProductLaunchIdentity,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";
import {
  isOpsLoginTemporarilyDisabled,
  isSameOriginOpsRequest,
} from "@/lib/opsLoginBypass";

const MAX_ITEM_COUNT = 5_000;
const MAX_STATE_BYTES = 8_000_000;

type TrackerStatePayload = {
  schemaVersion?: unknown;
  savedAt?: unknown;
  policy?: unknown;
  items?: unknown;
  serverDeletedItemIds?: unknown;
  partialPage?: unknown;
  partialItemIds?: unknown;
  [key: string]: unknown;
};

type StoredStateRow = {
  state_payload?: unknown;
  updated_at?: unknown;
  schema_version?: unknown;
};

export async function GET(request: NextRequest) {
  if (isOpsLoginTemporarilyDisabled() && !isSameOriginOpsRequest(request)) {
    return Response.json(
      {
        ok: false,
        code: "SAME_ORIGIN_REQUIRED",
        message: "OPS Center 화면에서만 진행관리 데이터를 읽을 수 있습니다.",
      },
      { status: 403 },
    );
  }

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
    )) as StoredStateRow | null;
    return Response.json({
      ok: true,
      state: row?.state_payload ?? null,
      updatedAt: row?.updated_at ?? null,
      schemaVersion: row?.schema_version ?? null,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_TRACKER_READ_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "진행관리 저장소를 읽지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  let incoming: TrackerStatePayload;
  try {
    const parsed = await request.json();
    incoming = normalizeStatePayload(parsed?.state);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_PRODUCT_LAUNCH_TRACKER_STATE",
        message:
          error instanceof Error
            ? error.message
            : "저장할 진행관리 데이터가 올바르지 않습니다.",
      },
      { status: 400 },
    );
  }

  try {
    if (incoming.partialPage === true) {
      const saved = await mergePartialStateWithRetry(
        config.value,
        identity.value,
        incoming,
      );
      return Response.json({
        ok: true,
        updatedAt: saved.updatedAt,
        schemaVersion: saved.schemaVersion,
        partialMerged: true,
      });
    }

    const existingRow = (await readProductLaunchState(
      config.value,
      identity.value.userId,
    )) as StoredStateRow | null;
    const existing = isRecord(existingRow?.state_payload)
      ? (existingRow.state_payload as TrackerStatePayload)
      : null;
    const state = prepareStateForStorage(
      normalizeStatePayload(
        preserveServerDeletedItems(incoming, existing),
      ),
    );
    const saved = (await writeProductLaunchState(
      config.value,
      identity.value,
      state,
    )) as StoredStateRow;

    return Response.json({
      ok: true,
      updatedAt: saved?.updated_at ?? new Date().toISOString(),
      schemaVersion: saved?.schema_version ?? Number(state.schemaVersion ?? 3),
      partialMerged: false,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_TRACKER_WRITE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "진행관리 저장소에 저장하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

async function mergePartialStateWithRetry(
  config: { supabaseUrl: string; secretKey: string },
  identity: { userId: string; email: string },
  incoming: TrackerStatePayload,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existingRow = (await readProductLaunchState(
      config,
      identity.userId,
    )) as StoredStateRow | null;
    const existing = isRecord(existingRow?.state_payload)
      ? (existingRow.state_payload as TrackerStatePayload)
      : null;
    if (!existing) {
      throw new Error(
        "전체 진행관리 저장본을 먼저 준비해야 부분 저장을 적용할 수 있습니다.",
      );
    }

    const state = prepareStateForStorage(
      normalizeStatePayload(
        preserveServerDeletedItems(mergePartialPage(existing, incoming), existing),
      ),
    );
    const previousUpdatedAt = nullableText(existingRow?.updated_at);
    if (!previousUpdatedAt) {
      const saved = (await writeProductLaunchState(
        config,
        identity,
        state,
      )) as StoredStateRow;
      return {
        updatedAt: nullableText(saved?.updated_at) ?? new Date().toISOString(),
        schemaVersion: numberOrDefault(saved?.schema_version, Number(state.schemaVersion ?? 3)),
      };
    }

    const saved = await conditionalWritePartialState(
      config,
      identity,
      state,
      previousUpdatedAt,
    );
    if (saved) {
      return {
        updatedAt: nullableText(saved.updated_at) ?? new Date().toISOString(),
        schemaVersion: numberOrDefault(saved.schema_version, Number(state.schemaVersion ?? 3)),
      };
    }
  }
  throw new Error(
    "다른 저장과 동시에 변경되었습니다. 최신 상태를 다시 불러온 뒤 한 번 더 시도하세요.",
  );
}

async function conditionalWritePartialState(
  config: { supabaseUrl: string; secretKey: string },
  identity: { userId: string; email: string },
  state: TrackerStatePayload,
  previousUpdatedAt: string,
) {
  const now = new Date().toISOString();
  const schemaVersion = Math.max(3, Math.floor(Number(state.schemaVersion) || 3));
  const params = new URLSearchParams({
    owner_id: `eq.${identity.userId}`,
    updated_at: `eq.${previousUpdatedAt}`,
  });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/product_launch_tracker_states?${params.toString()}`,
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
  return Array.isArray(body) ? (body[0] as StoredStateRow | undefined) ?? null : null;
}

function mergePartialPage(
  existing: TrackerStatePayload,
  incoming: TrackerStatePayload,
) {
  const existingItems = Array.isArray(existing.items)
    ? existing.items.filter(isRecord)
    : [];
  const incomingItems = Array.isArray(incoming.items)
    ? incoming.items.filter(isRecord)
    : [];
  const incomingById = new Map(
    incomingItems
      .map((item) => [String(item.id ?? "").trim(), item] as const)
      .filter(([id]) => id),
  );
  const mergedItems = existingItems.map((item) => {
    const id = String(item.id ?? "").trim();
    return (id && incomingById.get(id)) || item;
  });
  const existingIds = new Set(
    existingItems.map((item) => String(item.id ?? "").trim()).filter(Boolean),
  );
  for (const item of incomingItems) {
    const id = String(item.id ?? "").trim();
    if (!id || existingIds.has(id)) continue;
    mergedItems.push(item);
  }

  const merged: TrackerStatePayload = {
    ...existing,
    ...incoming,
    items: mergedItems,
    serverDeletedItemIds: [
      ...new Set([
        ...stringArray(existing.serverDeletedItemIds),
        ...stringArray(incoming.serverDeletedItemIds),
      ]),
    ],
    savedAt:
      typeof incoming.savedAt === "string" && incoming.savedAt.trim()
        ? incoming.savedAt
        : new Date().toISOString(),
  };
  delete merged.partialPage;
  delete merged.partialItemIds;
  delete merged[PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD];
  return merged;
}

function normalizeStatePayload(value: unknown): TrackerStatePayload {
  if (!isRecord(value)) {
    throw new Error("진행관리 state 객체가 필요합니다.");
  }
  const cloned = JSON.parse(JSON.stringify(value)) as TrackerStatePayload;
  delete cloned[PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD];
  if (!Array.isArray(cloned.items)) {
    throw new Error("진행관리 상품 목록(items)이 필요합니다.");
  }
  if (cloned.items.length > MAX_ITEM_COUNT) {
    throw new Error(
      `진행관리 상품은 최대 ${MAX_ITEM_COUNT.toLocaleString("ko-KR")}건까지 저장할 수 있습니다.`,
    );
  }
  const serialized = JSON.stringify(cloned);
  if (new TextEncoder().encode(serialized).byteLength > MAX_STATE_BYTES) {
    throw new Error(
      "진행관리 데이터 크기가 8MB를 초과했습니다. 상세페이지 원본 이미지는 URL로 연결하세요.",
    );
  }
  return cloned;
}

function prepareStateForStorage(state: TrackerStatePayload) {
  return withProductLaunchListSnapshot(
    state as ProductLaunchTrackerState,
  ) as TrackerStatePayload;
}

function preserveServerDeletedItems(
  incoming: TrackerStatePayload,
  existing: TrackerStatePayload | null,
) {
  const deletedIds = new Set([
    ...stringArray(existing?.serverDeletedItemIds),
    ...stringArray(incoming.serverDeletedItemIds),
  ]);
  if (!deletedIds.size) return incoming;

  const items = Array.isArray(incoming.items)
    ? incoming.items.filter((item) => {
        if (!isRecord(item)) return true;
        const id = String(item.id ?? "").trim();
        return !id || !deletedIds.has(id);
      })
    : [];

  return {
    ...incoming,
    serverDeletedItemIds: [...deletedIds],
    items,
  };
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => String(entry ?? "").trim()).filter(Boolean))];
}

function nullableText(value: unknown) {
  const result = typeof value === "string" ? value.trim() : "";
  return result || null;
}

function numberOrDefault(value: unknown, fallback: number) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
