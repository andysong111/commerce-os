import { NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  getProductLaunchAdminConfig,
  readProductLaunchError,
  readProductLaunchListSnapshot,
  readProductLaunchState,
  readResponseJson,
  resolveProductLaunchIdentity,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";
import {
  PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD,
  buildProductLaunchListIndex,
  buildProductLaunchListSnapshot,
  parseProductLaunchListSnapshot,
  queryProductLaunchListPage,
  withProductLaunchListSnapshot,
  type ProductLaunchTrackerListIndex,
} from "@/lib/productLaunchTrackerListSnapshot";
import {
  applyProductLaunchTrackerMutation,
  buildProductLaunchTrackerIndex,
  getProductLaunchTrackerItem,
  type ProductLaunchTrackerIndex,
  type ProductLaunchTrackerState,
} from "@/lib/productLaunchTrackerOptimized";

const TABLE_NAME = "product_launch_tracker_states";
const CACHE_STAMP_TTL_MS = 1_000;
const MAX_CACHE_OWNERS = 24;
const cache = new Map<
  string,
  {
    updatedAt: string | null;
    schemaVersion: number | null;
    checkedAt: number;
    accessedAt: number;
    index: ProductLaunchTrackerIndex;
  }
>();
const listCache = new Map<
  string,
  {
    updatedAt: string | null;
    schemaVersion: number | null;
    checkedAt: number;
    accessedAt: number;
    source: "snapshot" | "full_fallback";
    index: ProductLaunchTrackerListIndex;
  }
>();
const mutationQueues = new Map<string, Promise<unknown>>();

type StoredRow = {
  state_payload?: unknown;
  updated_at?: unknown;
  schema_version?: unknown;
  owner_email?: unknown;
};

type ListStoredRow = {
  list_snapshot?: unknown;
  updated_at?: unknown;
  schema_version?: unknown;
};

export async function GET(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  try {
    const mode = request.nextUrl.searchParams.get("mode") || "page";
    if (mode === "page") {
      const loaded = await loadCachedListIndex(
        config.value,
        identity.value.userId,
      );
      if (!loaded) {
        return Response.json({
          ok: true,
          stateExists: false,
          updatedAt: null,
          schemaVersion: null,
        });
      }

      const page = queryProductLaunchListPage(loaded.index, {
        page: request.nextUrl.searchParams.get("page"),
        pageSize: request.nextUrl.searchParams.get("pageSize"),
        search: request.nextUrl.searchParams.get("search"),
        batch: request.nextUrl.searchParams.get("batch"),
        assignee: request.nextUrl.searchParams.get("assignee"),
        overall: request.nextUrl.searchParams.get("overall"),
        unfinishedOnly: request.nextUrl.searchParams.get("unfinishedOnly"),
        sort: request.nextUrl.searchParams.get("sort"),
        direction: request.nextUrl.searchParams.get("direction"),
      });

      return Response.json({
        ok: true,
        stateExists: true,
        ...page,
        policy: loaded.index.snapshot.policy ?? null,
        sourceImportedAt: loaded.index.snapshot.sourceImportedAt ?? null,
        updatedAt: loaded.updatedAt,
        schemaVersion: loaded.schemaVersion,
        listSource: loaded.source,
      });
    }

    const loaded = await loadCachedIndex(
      config.value,
      identity.value.userId,
    );
    if (!loaded) {
      return Response.json({
        ok: true,
        stateExists: false,
        updatedAt: null,
        schemaVersion: null,
      });
    }

    if (mode === "items") {
      const requestedIds = [
        ...new Set(
          request.nextUrl.searchParams
            .getAll("id")
            .flatMap((value) => value.split(","))
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ];
      if (!requestedIds.length) {
        return Response.json(
          {
            ok: false,
            code: "PRODUCT_LAUNCH_TRACKER_ITEM_IDS_REQUIRED",
            message: "불러올 상품 ID가 필요합니다.",
          },
          { status: 400 },
        );
      }
      if (requestedIds.length > 100) {
        return Response.json(
          {
            ok: false,
            code: "PRODUCT_LAUNCH_TRACKER_ITEM_LIMIT_EXCEEDED",
            message: "한 번에 최대 100개 상품까지 불러올 수 있습니다.",
          },
          { status: 400 },
        );
      }
      const items: unknown[] = [];
      const missingIds: string[] = [];
      for (const itemId of requestedIds) {
        const item = getProductLaunchTrackerItem(loaded.index, itemId);
        if (item) items.push(item);
        else missingIds.push(itemId);
      }
      if (missingIds.length) {
        return Response.json(
          {
            ok: false,
            code: "PRODUCT_LAUNCH_TRACKER_ITEMS_NOT_FOUND",
            message: "일부 상품 기록을 찾지 못했습니다. 목록을 새로고침한 뒤 다시 선택하세요.",
            missingIds,
          },
          { status: 404 },
        );
      }
      return Response.json({
        ok: true,
        stateExists: true,
        items,
        updatedAt: loaded.updatedAt,
        schemaVersion: loaded.schemaVersion,
      });
    }

    if (mode === "item") {
      const item = getProductLaunchTrackerItem(
        loaded.index,
        request.nextUrl.searchParams.get("id"),
      );
      if (!item) {
        return Response.json(
          {
            ok: false,
            code: "PRODUCT_LAUNCH_TRACKER_ITEM_NOT_FOUND",
            message: "상품 기록을 찾지 못했습니다.",
          },
          { status: 404 },
        );
      }
      return Response.json({
        ok: true,
        stateExists: true,
        item,
        policy: loaded.index.state.policy ?? null,
        updatedAt: loaded.updatedAt,
        schemaVersion: loaded.schemaVersion,
      });
    }

    if (mode === "export") {
      return Response.json({
        ok: true,
        stateExists: true,
        state: loaded.index.state,
        updatedAt: loaded.updatedAt,
        schemaVersion: loaded.schemaVersion,
      });
    }

    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_TRACKER_MODE_NOT_SUPPORTED",
        message: "지원하지 않는 진행관리 조회 방식입니다.",
      },
      { status: 400 },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_TRACKER_OPTIMIZED_READ_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "진행관리 목록을 불러오지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json(
      {
        ok: false,
        code: "INVALID_PRODUCT_LAUNCH_TRACKER_MUTATION",
        message: "변경 요청 JSON이 올바르지 않습니다.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await enqueueMutation(identity.value.userId, () =>
      mutateStateWithRetry(config.value, identity.value, input),
    );
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "진행관리 데이터를 저장하지 못했습니다.";
    const status = message.includes("찾지 못")
      ? 404
      : message.includes("동시에")
        ? 409
        : /필요|선택|지원하지|최대|올바르지/.test(message)
          ? 400
          : 500;
    return Response.json(
      {
        ok: false,
        code:
          status === 409
            ? "PRODUCT_LAUNCH_TRACKER_CONCURRENT_UPDATE"
            : "PRODUCT_LAUNCH_TRACKER_MUTATION_FAILED",
        message,
      },
      { status },
    );
  }
}

async function loadCachedListIndex(
  config: { supabaseUrl: string; secretKey: string },
  ownerId: string,
) {
  const existing = listCache.get(ownerId);
  const now = Date.now();
  if (existing && now - existing.checkedAt < CACHE_STAMP_TTL_MS) {
    existing.accessedAt = now;
    return {
      updatedAt: existing.updatedAt,
      schemaVersion: existing.schemaVersion,
      source: existing.source,
      index: existing.index,
    };
  }

  if (!existing) return loadAndCacheListSnapshot(config, ownerId);

  const stamp = await readStateStamp(config, ownerId);
  if (!stamp) {
    listCache.delete(ownerId);
    cache.delete(ownerId);
    return null;
  }
  if (existing.updatedAt === stamp.updatedAt) {
    existing.checkedAt = now;
    existing.accessedAt = now;
    existing.schemaVersion = stamp.schemaVersion;
    return {
      updatedAt: stamp.updatedAt,
      schemaVersion: stamp.schemaVersion,
      source: existing.source,
      index: existing.index,
    };
  }

  return loadAndCacheListSnapshot(config, ownerId);
}

async function loadAndCacheListSnapshot(
  config: { supabaseUrl: string; secretKey: string },
  ownerId: string,
) {
  const row = (await readProductLaunchListSnapshot(
    config,
    ownerId,
  )) as ListStoredRow | null;
  if (!row) return null;

  const updatedAt = nullableText(row.updated_at);
  const schemaVersion = numberOrNull(row.schema_version);
  const snapshot = parseProductLaunchListSnapshot(row.list_snapshot);
  if (snapshot) {
    const index = buildProductLaunchListIndex(snapshot);
    setListCache(ownerId, {
      updatedAt,
      schemaVersion,
      source: "snapshot",
      index,
    });
    return {
      updatedAt,
      schemaVersion,
      source: "snapshot" as const,
      index,
    };
  }

  const full = await loadAndCacheFullState(config, ownerId);
  if (!full) return null;
  const fallbackSnapshot = buildProductLaunchListSnapshot(full.index.state);
  const index = buildProductLaunchListIndex(fallbackSnapshot);
  setListCache(ownerId, {
    updatedAt: full.updatedAt,
    schemaVersion: full.schemaVersion,
    source: "full_fallback",
    index,
  });
  return {
    updatedAt: full.updatedAt,
    schemaVersion: full.schemaVersion,
    source: "full_fallback" as const,
    index,
  };
}

async function loadCachedIndex(
  config: { supabaseUrl: string; secretKey: string },
  ownerId: string,
) {
  const existing = cache.get(ownerId);
  const now = Date.now();
  if (existing && now - existing.checkedAt < CACHE_STAMP_TTL_MS) {
    existing.accessedAt = now;
    return {
      updatedAt: existing.updatedAt,
      schemaVersion: existing.schemaVersion,
      index: existing.index,
    };
  }

  if (!existing) return loadAndCacheFullState(config, ownerId);

  const stamp = await readStateStamp(config, ownerId);
  if (!stamp) {
    cache.delete(ownerId);
    listCache.delete(ownerId);
    return null;
  }
  if (existing.updatedAt === stamp.updatedAt) {
    existing.checkedAt = now;
    existing.accessedAt = now;
    existing.schemaVersion = stamp.schemaVersion;
    return {
      updatedAt: stamp.updatedAt,
      schemaVersion: stamp.schemaVersion,
      index: existing.index,
    };
  }

  return loadAndCacheFullState(config, ownerId);
}

async function loadAndCacheFullState(
  config: { supabaseUrl: string; secretKey: string },
  ownerId: string,
) {
  const row = (await readProductLaunchState(config, ownerId)) as StoredRow | null;
  if (!row || !isRecord(row.state_payload)) return null;
  const state = row.state_payload as ProductLaunchTrackerState;
  const index = buildProductLaunchTrackerIndex(state);
  const updatedAt = nullableText(row.updated_at);
  const schemaVersion = numberOrNull(row.schema_version);
  setCache(ownerId, { updatedAt, schemaVersion, index });

  const snapshot =
    parseProductLaunchListSnapshot(
      state[PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD],
    ) ?? buildProductLaunchListSnapshot(state);
  setListCache(ownerId, {
    updatedAt,
    schemaVersion,
    source: parseProductLaunchListSnapshot(
      state[PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD],
    )
      ? "snapshot"
      : "full_fallback",
    index: buildProductLaunchListIndex(snapshot),
  });
  return { updatedAt, schemaVersion, index };
}

async function mutateStateWithRetry(
  config: { supabaseUrl: string; secretKey: string },
  identity: { userId: string; email: string },
  input: unknown,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = (await readProductLaunchState(
      config,
      identity.userId,
    )) as StoredRow | null;
    if (!row || !isRecord(row.state_payload)) {
      throw new Error("저장된 진행관리 상태를 찾지 못했습니다.");
    }

    const mutation = applyProductLaunchTrackerMutation(
      row.state_payload as ProductLaunchTrackerState,
      input,
    );
    const persistedState = withProductLaunchListSnapshot(mutation.state);
    const saved = await conditionalWriteState(
      config,
      identity,
      persistedState,
      nullableText(row.updated_at),
    );
    if (!saved) continue;

    const index = buildProductLaunchTrackerIndex(persistedState);
    const listSnapshot =
      parseProductLaunchListSnapshot(
        persistedState[PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD],
      ) ?? buildProductLaunchListSnapshot(persistedState);
    const updatedAt = nullableText(saved.updated_at) || new Date().toISOString();
    const schemaVersion = numberOrNull(saved.schema_version) ?? 3;
    setCache(identity.userId, {
      updatedAt,
      schemaVersion,
      index,
    });
    setListCache(identity.userId, {
      updatedAt,
      schemaVersion,
      source: "snapshot",
      index: buildProductLaunchListIndex(listSnapshot),
    });
    const changedItems = mutation.changedIds
      .map((id) => index.summariesById.get(id))
      .filter(Boolean)
      .map((summary) => {
        const { searchText: _searchText, ...safeSummary } = summary!;
        return safeSummary;
      });

    return {
      updatedAt,
      schemaVersion,
      changedIds: mutation.changedIds,
      createdIds: mutation.createdIds,
      items: changedItems,
      counts: index.counts,
      filterOptions: index.filterOptions,
    };
  }

  throw new Error(
    "다른 저장과 동시에 변경되었습니다. 최신 상태를 다시 불러온 뒤 한 번 더 시도하세요.",
  );
}

async function conditionalWriteState(
  config: { supabaseUrl: string; secretKey: string },
  identity: { userId: string; email: string },
  state: ProductLaunchTrackerState,
  previousUpdatedAt: string | null,
) {
  if (!previousUpdatedAt) {
    return (await writeProductLaunchState(config, identity, state)) as StoredRow;
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

async function readStateStamp(
  config: { supabaseUrl: string; secretKey: string },
  ownerId: string,
) {
  const params = new URLSearchParams({
    select: "updated_at,schema_version",
    owner_id: `eq.${ownerId}`,
    limit: "1",
  });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${TABLE_NAME}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  const body = await readResponseJson(response);
  if (!response.ok) {
    throw new Error(readProductLaunchError(body, response.status));
  }
  const row = Array.isArray(body) ? (body[0] as StoredRow | undefined) : undefined;
  if (!row) return null;
  return {
    updatedAt: nullableText(row.updated_at),
    schemaVersion: numberOrNull(row.schema_version),
  };
}

function setCache(
  ownerId: string,
  value: {
    updatedAt: string | null;
    schemaVersion: number | null;
    index: ProductLaunchTrackerIndex;
  },
) {
  const now = Date.now();
  cache.set(ownerId, { ...value, checkedAt: now, accessedAt: now });
  trimCache(cache, ownerId);
}

function setListCache(
  ownerId: string,
  value: {
    updatedAt: string | null;
    schemaVersion: number | null;
    source: "snapshot" | "full_fallback";
    index: ProductLaunchTrackerListIndex;
  },
) {
  const now = Date.now();
  listCache.set(ownerId, { ...value, checkedAt: now, accessedAt: now });
  trimCache(listCache, ownerId);
}

function trimCache<T extends { accessedAt: number }>(
  target: Map<string, T>,
  ownerId: string,
) {
  if (target.size <= MAX_CACHE_OWNERS) return;
  const oldest = [...target.entries()]
    .filter(([key]) => key !== ownerId)
    .sort((left, right) => left[1].accessedAt - right[1].accessedAt)[0];
  if (oldest) target.delete(oldest[0]);
}

function enqueueMutation<T>(ownerId: string, operation: () => Promise<T>) {
  const previous = mutationQueues.get(ownerId) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  mutationQueues.set(ownerId, settled);
  void settled.finally(() => {
    if (mutationQueues.get(ownerId) === settled) mutationQueues.delete(ownerId);
  });
  return current;
}

function nullableText(value: unknown) {
  const result = typeof value === "string" ? value.trim() : "";
  return result || null;
}

function numberOrNull(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
