import { NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  resolveProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";
import {
  isProductLaunchNormalizedFresh,
  queryProductLaunchNormalizedPage,
  readProductLaunchNormalizedItem,
  readProductLaunchNormalizedItems,
  readProductLaunchNormalizedWorkspace,
  syncProductLaunchNormalizedChangedItems,
} from "@/lib/productLaunchTrackerNormalizedStore";
import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";

export const runtime = "nodejs";
export const maxDuration = 300;

const LEGACY_ROUTE = "/api/product-launch-tracker/optimized-legacy";

type UnknownRecord = Record<string, unknown>;
type LegacyStamp = {
  updatedAt: string | null;
  schemaVersion: number | null;
};
type StoredRow = {
  state_payload?: unknown;
  updated_at?: unknown;
};

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") || "page";
  if (mode === "export") return proxyLegacy(request);

  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  try {
    const [workspace, stamp] = await Promise.all([
      readProductLaunchNormalizedWorkspace(config.value, identity.value.userId),
      readLegacyStamp(config.value, identity.value.userId),
    ]);
    if (!workspace || !stamp || !isProductLaunchNormalizedFresh(workspace, stamp.updatedAt)) {
      return proxyLegacy(request);
    }

    if (mode === "page") {
      const page = await queryProductLaunchNormalizedPage(
        config.value,
        identity.value.userId,
        workspace,
        {
          page: request.nextUrl.searchParams.get("page"),
          pageSize: request.nextUrl.searchParams.get("pageSize"),
          search: request.nextUrl.searchParams.get("search"),
          batch: request.nextUrl.searchParams.get("batch"),
          assignee: request.nextUrl.searchParams.get("assignee"),
          overall: request.nextUrl.searchParams.get("overall"),
          unfinishedOnly: request.nextUrl.searchParams.get("unfinishedOnly"),
          sort: request.nextUrl.searchParams.get("sort"),
          direction: request.nextUrl.searchParams.get("direction"),
        },
      );
      return Response.json({
        ok: true,
        stateExists: true,
        ...page,
        policy: workspace.policy ?? null,
        sourceImportedAt: workspace.source_imported_at ?? null,
        updatedAt: stamp.updatedAt,
        schemaVersion: stamp.schemaVersion,
        listSource: "normalized",
      });
    }

    if (mode === "items") {
      const requestedIds = requestedItemIds(request);
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
      const items = await readProductLaunchNormalizedItems(
        config.value,
        identity.value.userId,
        requestedIds,
      );
      if (items.length !== requestedIds.length) return proxyLegacy(request);
      return Response.json({
        ok: true,
        stateExists: true,
        items,
        updatedAt: stamp.updatedAt,
        schemaVersion: stamp.schemaVersion,
        itemSource: "normalized",
      });
    }

    if (mode === "item") {
      const item = await readProductLaunchNormalizedItem(
        config.value,
        identity.value.userId,
        request.nextUrl.searchParams.get("id") ?? "",
      );
      if (!item) return proxyLegacy(request);
      return Response.json({
        ok: true,
        stateExists: true,
        item,
        policy: workspace.policy ?? null,
        updatedAt: stamp.updatedAt,
        schemaVersion: stamp.schemaVersion,
        itemSource: "normalized",
      });
    }

    return proxyLegacy(request);
  } catch (error) {
    console.warn(
      "[product-launch-normalized] read fallback:",
      error instanceof Error ? error.message : String(error),
    );
    return proxyLegacy(request);
  }
}

export async function PATCH(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  const proxied = await proxyLegacyText(request);
  if (!proxied.response.ok) return responseFromProxy(proxied.response, proxied.text);

  const payload = parseJson(proxied.text);
  if (!isRecord(payload) || payload.ok !== true) {
    return responseFromProxy(proxied.response, proxied.text);
  }

  let normalizedSync: UnknownRecord;
  try {
    const row = (await readProductLaunchState(
      config.value,
      identity.value.userId,
    )) as StoredRow | null;
    if (!row || !isRecord(row.state_payload)) {
      normalizedSync = { synced: false, reason: "legacy_state_missing" };
    } else {
      normalizedSync = (await syncProductLaunchNormalizedChangedItems(
        config.value,
        identity.value,
        row.state_payload as ProductLaunchTrackerState,
        text(payload.updatedAt) || text(row.updated_at),
        stringArray(payload.changedIds),
      )) as UnknownRecord;
    }
  } catch (error) {
    normalizedSync = {
      synced: false,
      reason: "sync_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return Response.json(
    { ...payload, normalizedSync },
    { status: proxied.response.status },
  );
}

export async function POST(request: NextRequest) {
  return proxyLegacy(request);
}

export async function PUT(request: NextRequest) {
  return proxyLegacy(request);
}

export async function DELETE(request: NextRequest) {
  return proxyLegacy(request);
}

async function readLegacyStamp(
  config: { supabaseUrl: string; secretKey: string },
  ownerId: string,
): Promise<LegacyStamp | null> {
  const params = new URLSearchParams({
    select: "updated_at,schema_version",
    owner_id: `eq.${ownerId}`,
    limit: "1",
  });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/product_launch_tracker_states?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  const textBody = await response.text();
  const body = parseJson(textBody);
  if (!response.ok) {
    throw new Error(readError(body, response.status));
  }
  const row = Array.isArray(body) && isRecord(body[0]) ? body[0] : null;
  if (!row) return null;
  return {
    updatedAt: nullableText(row.updated_at),
    schemaVersion: numberOrNull(row.schema_version),
  };
}

async function proxyLegacy(request: NextRequest) {
  const proxied = await proxyLegacyText(request);
  return responseFromProxy(proxied.response, proxied.text);
}

async function proxyLegacyText(request: NextRequest) {
  const target = new URL(LEGACY_ROUTE, request.url);
  target.search = request.nextUrl.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.set("x-product-launch-normalized-bypass", "1");
  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  const response = await fetch(target, {
    method,
    headers,
    body,
    cache: "no-store",
    redirect: "manual",
  });
  const text = await response.text();
  return { response, text };
}

function responseFromProxy(response: Response, body: string) {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function requestedItemIds(request: NextRequest) {
  return [
    ...new Set(
      request.nextUrl.searchParams
        .getAll("id")
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map(text).filter(Boolean))]
    : [];
}

function parseJson(value: string): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readError(body: unknown, status: number) {
  if (isRecord(body)) {
    for (const value of [body.message, body.error, body.details]) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  if (typeof body === "string" && body.trim()) return body.trim();
  return `상품출시진행관리 저장소 요청에 실패했습니다. status=${status}`;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function nullableText(value: unknown) {
  const result = text(value);
  return result || null;
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
