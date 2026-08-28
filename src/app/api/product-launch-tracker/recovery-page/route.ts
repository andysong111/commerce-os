import { NextRequest } from "next/server";

import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  getProductLaunchAdminConfig,
  readProductLaunchStorageJson,
  resolveProductLaunchIdentity,
  type ProductLaunchAdminConfig,
} from "@/lib/productLaunchTrackerServer";
import {
  PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD,
  buildProductLaunchListIndex,
  parseProductLaunchListSnapshot,
  queryProductLaunchListPage,
} from "@/lib/productLaunchTrackerListSnapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RECOVERY_READ_TIMEOUT_MS = 3_000;
const SNAPSHOT_TABLE = "product_launch_list_snapshots";
const LEGACY_TABLE = "product_launch_tracker_states";

type SnapshotRow = {
  snapshot_payload?: unknown;
  source_state_updated_at?: unknown;
  updated_at?: unknown;
  schema_version?: unknown;
  list_source?: unknown;
};

export async function GET(request: NextRequest) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  const config = getProductLaunchAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });

  try {
    const row = await readSnapshotRow(
      config.value,
      identity.value.userId,
    );
    if (!row) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_RECOVERY_SNAPSHOT_MISSING",
          message: "상품출시 복구용 목록 스냅샷을 찾지 못했습니다.",
          retryable: true,
        },
        { status: 503, headers: { "Retry-After": "2", "Cache-Control": "private, no-store" } },
      );
    }

    const snapshot = parseProductLaunchListSnapshot(row.snapshot_payload);
    if (!snapshot) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_RECOVERY_SNAPSHOT_INVALID",
          message: "상품출시 복구용 목록 스냅샷을 읽지 못했습니다.",
          retryable: true,
        },
        { status: 503, headers: { "Retry-After": "2", "Cache-Control": "private, no-store" } },
      );
    }

    const index = buildProductLaunchListIndex(snapshot);
    const page = queryProductLaunchListPage(index, pageQuery(request));
    const source = nullableText(row.list_source) || "snapshot-read-model";

    return Response.json(
      {
        ok: true,
        stateExists: true,
        ...page,
        policy: index.snapshot.policy ?? null,
        sourceImportedAt: index.snapshot.sourceImportedAt ?? null,
        updatedAt:
          nullableText(row.source_state_updated_at) ?? nullableText(row.updated_at),
        schemaVersion: numberOrNull(row.schema_version),
        listSource: source,
        workflowSource: source,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Commerce-Workflow-Recovery": source,
        },
      },
    );
  } catch (error) {
    console.error("[product-launch-recovery-page] snapshot read failed", error);
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_RECOVERY_TEMPORARILY_UNAVAILABLE",
        message:
          error instanceof Error
            ? error.message
            : "상품출시 복구용 목록 저장소가 일시적으로 지연되고 있습니다.",
        retryable: true,
      },
      {
        status: 503,
        headers: {
          "Retry-After": "2",
          "Cache-Control": "private, no-store",
        },
      },
    );
  }
}

async function readSnapshotRow(
  config: ProductLaunchAdminConfig,
  ownerId: string,
): Promise<SnapshotRow | null> {
  try {
    const params = new URLSearchParams({
      select: "snapshot_payload,source_state_updated_at,updated_at,schema_version",
      owner_id: `eq.${ownerId}`,
      limit: "1",
    });
    const { body } = await readProductLaunchStorageJson(
      `${config.supabaseUrl}/rest/v1/${SNAPSHOT_TABLE}?${params.toString()}`,
      {
        headers: createSupabaseAdminHeaders(config.secretKey),
        cache: "no-store",
      },
      {
        attempts: 1,
        timeoutMs: RECOVERY_READ_TIMEOUT_MS,
        retryDelaysMs: [],
      },
    );
    const row = Array.isArray(body) ? (body[0] as SnapshotRow | undefined) : undefined;
    if (row) return { ...row, list_source: "snapshot-read-model" };
  } catch (error) {
    console.warn("[product-launch-recovery-page] compact snapshot fallback", error);
  }

  const params = new URLSearchParams({
    select: `snapshot_payload:state_payload->${PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD},source_state_updated_at:updated_at,updated_at,schema_version`,
    owner_id: `eq.${ownerId}`,
    limit: "1",
  });
  const { body } = await readProductLaunchStorageJson(
    `${config.supabaseUrl}/rest/v1/${LEGACY_TABLE}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
    {
      attempts: 1,
      timeoutMs: RECOVERY_READ_TIMEOUT_MS,
      retryDelaysMs: [],
    },
  );
  const row = Array.isArray(body) ? (body[0] as SnapshotRow | undefined) : undefined;
  return row ? { ...row, list_source: "legacy-snapshot-fallback" } : null;
}

function pageQuery(request: NextRequest) {
  return {
    page: request.nextUrl.searchParams.get("page"),
    pageSize: request.nextUrl.searchParams.get("pageSize"),
    search: request.nextUrl.searchParams.get("search"),
    batch: request.nextUrl.searchParams.get("batch"),
    assignee: request.nextUrl.searchParams.get("assignee"),
    overall: request.nextUrl.searchParams.get("overall"),
    unfinishedOnly: request.nextUrl.searchParams.get("unfinishedOnly"),
    sort: request.nextUrl.searchParams.get("sort"),
    direction: request.nextUrl.searchParams.get("direction"),
  };
}

function nullableText(value: unknown) {
  const result = typeof value === "string" ? value.trim() : "";
  return result || null;
}

function numberOrNull(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
