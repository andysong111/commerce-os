import { NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD,
  buildProductLaunchListSnapshot,
  parseProductLaunchListSnapshot,
  withProductLaunchListSnapshot,
} from "@/lib/productLaunchTrackerListSnapshot";
import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";
import {
  getProductLaunchAdminConfig,
  readProductLaunchError,
  readProductLaunchListSnapshot,
  readProductLaunchState,
  readResponseJson,
  resolveProductLaunchIdentity,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";

export const runtime = "nodejs";

const TABLE_NAME = "product_launch_tracker_states";
const MIGRATION_KEY = "productLaunchListSnapshot20260813";
const MIGRATION_VERSION = "2026-08-13-list-snapshot-v1";

type UnknownRecord = Record<string, unknown>;
type StoredRow = {
  state_payload?: unknown;
  updated_at?: unknown;
  schema_version?: unknown;
};
type ListStoredRow = {
  list_snapshot?: unknown;
  updated_at?: unknown;
  schema_version?: unknown;
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

    const state = row.state_payload as ProductLaunchTrackerState;
    const marker = asRecord(asRecord(state.serverMigrations)[MIGRATION_KEY]);
    const existingSnapshot = parseProductLaunchListSnapshot(
      state[PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD],
    );
    const generatedSnapshot = buildProductLaunchListSnapshot(state);
    const report = buildReport(state, generatedSnapshot, existingSnapshot);

    if (text(marker.status) === "applied") {
      const verified = await verifyStoredSnapshot(
        config.value,
        identity.value.userId,
        generatedSnapshot.itemCount,
      );
      if (!verified.ok) {
        return Response.json(
          {
            ok: false,
            code: "PRODUCT_LAUNCH_LIST_SNAPSHOT_VERIFY_FAILED",
            message: verified.message,
            report: marker.report ?? report,
          },
          { status: 500 },
        );
      }
      return Response.json({
        ok: true,
        alreadyApplied: true,
        appliedAt: text(marker.appliedAt),
        snapshotReadable: true,
        snapshotItemCount: verified.itemCount,
        report: marker.report ?? report,
      });
    }

    const apply = request.nextUrl.searchParams.get("apply") === "1";
    if (!apply) {
      return Response.json({
        ok: true,
        dryRun: true,
        report,
      });
    }

    const appliedAt = new Date().toISOString();
    const nextState = withProductLaunchListSnapshot({
      ...state,
      savedAt: appliedAt,
      serverMigrations: {
        ...asRecord(state.serverMigrations),
        [MIGRATION_KEY]: {
          status: "applied",
          version: MIGRATION_VERSION,
          appliedAt,
          report,
        },
      },
    });

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
          code: "PRODUCT_LAUNCH_LIST_SNAPSHOT_CONCURRENT_UPDATE",
          message:
            "목록 인덱스 저장 중 다른 수정이 발생했습니다. 최신 상태로 다시 실행하세요.",
          report,
        },
        { status: 409 },
      );
    }

    const verified = await verifyStoredSnapshot(
      config.value,
      identity.value.userId,
      generatedSnapshot.itemCount,
    );
    if (!verified.ok) {
      return Response.json(
        {
          ok: false,
          code: "PRODUCT_LAUNCH_LIST_SNAPSHOT_VERIFY_FAILED",
          message: verified.message,
          report,
        },
        { status: 500 },
      );
    }

    return Response.json({
      ok: true,
      applied: true,
      appliedAt,
      snapshotReadable: true,
      snapshotItemCount: verified.itemCount,
      report,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_LIST_SNAPSHOT_MIGRATION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "상품출시진행관리 경량 목록 인덱스를 만들지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

function buildReport(
  state: ProductLaunchTrackerState,
  generatedSnapshot: ReturnType<typeof buildProductLaunchListSnapshot>,
  existingSnapshot: ReturnType<typeof parseProductLaunchListSnapshot>,
) {
  const fullStateBytes = byteLength(state);
  const snapshotBytes = byteLength(generatedSnapshot);
  const reductionPercent = fullStateBytes
    ? Math.max(0, Math.round((1 - snapshotBytes / fullStateBytes) * 10_000) / 100)
    : 0;
  return {
    version: MIGRATION_VERSION,
    stateItemCount: Array.isArray(state.items) ? state.items.length : 0,
    snapshotItemCount: generatedSnapshot.itemCount,
    existingSnapshot: Boolean(existingSnapshot),
    existingSnapshotItemCount: existingSnapshot?.itemCount ?? 0,
    fullStateBytes,
    snapshotBytes,
    reductionPercent,
    readPath: `state_payload->${PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD}`,
  };
}

async function verifyStoredSnapshot(
  config: { supabaseUrl: string; secretKey: string },
  ownerId: string,
  expectedItemCount: number,
): Promise<
  | { ok: true; itemCount: number }
  | { ok: false; message: string }
> {
  const row = (await readProductLaunchListSnapshot(
    config,
    ownerId,
  )) as ListStoredRow | null;
  const snapshot = parseProductLaunchListSnapshot(row?.list_snapshot);
  if (!snapshot) {
    return {
      ok: false,
      message:
        "Supabase JSON 경로에서 경량 목록 인덱스를 다시 읽지 못했습니다.",
    };
  }
  if (snapshot.itemCount !== expectedItemCount) {
    return {
      ok: false,
      message: `경량 목록 인덱스 상품 수가 예상 ${expectedItemCount}건과 다릅니다. actual=${snapshot.itemCount}`,
    };
  }
  return { ok: true, itemCount: snapshot.itemCount };
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

function byteLength(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function nullableText(value: unknown) {
  const result = typeof value === "string" ? value.trim() : "";
  return result || null;
}

function text(value: unknown) {
  return typeof value === "string"
    ? value.trim()
    : value == null
      ? ""
      : String(value).trim();
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
