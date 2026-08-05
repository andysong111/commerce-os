import { NextRequest } from "next/server";
import {
  createSupabaseAdminHeaders,
} from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isOpsLoginTemporarilyDisabled,
  isSameOriginOpsRequest,
  temporaryOpsIdentity,
} from "@/lib/opsLoginBypass";

const TABLE_NAME = "product_launch_tracker_states";
const MAX_ITEM_COUNT = 5_000;
const MAX_STATE_BYTES = 8_000_000;

type TrackerIdentity = {
  userId: string;
  email: string;
};

type TrackerStatePayload = {
  schemaVersion?: unknown;
  savedAt?: unknown;
  policy?: unknown;
  items?: unknown;
  serverDeletedItemIds?: unknown;
  [key: string]: unknown;
};

export async function GET(request: NextRequest) {
  const identity = await resolveTrackerIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  const config = getAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: 503 });

  const params = new URLSearchParams({
    select: "state_payload,updated_at,schema_version",
    owner_id: `eq.${identity.value.userId}`,
    limit: "1",
  });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${TABLE_NAME}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  const body = await readJson(response);
  if (!response.ok) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_TRACKER_READ_FAILED",
        message: readErrorMessage(body, response.status),
      },
      { status: 500 },
    );
  }

  const row = Array.isArray(body) ? body[0] : null;
  return Response.json({
    ok: true,
    state: row?.state_payload ?? null,
    updatedAt: row?.updated_at ?? null,
    schemaVersion: row?.schema_version ?? null,
  });
}

export async function PUT(request: NextRequest) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      {
        ok: false,
        code: "SAME_ORIGIN_REQUIRED",
        message: "OPS Center 화면에서만 진행관리 데이터를 저장할 수 있습니다.",
      },
      { status: 403 },
    );
  }

  const identity = await resolveTrackerIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });

  const config = getAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: 503 });

  let state: TrackerStatePayload;
  try {
    const parsed = await request.json();
    state = normalizeStatePayload(parsed?.state);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "INVALID_PRODUCT_LAUNCH_TRACKER_STATE",
        message: error instanceof Error ? error.message : "저장할 진행관리 데이터가 올바르지 않습니다.",
      },
      { status: 400 },
    );
  }

  const existing = await readExistingState(
    config.supabaseUrl,
    config.secretKey,
    identity.value.userId,
  );
  if (!existing.ok) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_TRACKER_READ_BEFORE_WRITE_FAILED",
        message: existing.message,
      },
      { status: 500 },
    );
  }
  state = preserveServerDeletedItems(state, existing.state);

  const schemaVersion = Number(state.schemaVersion ?? 3);
  const row = {
    owner_id: identity.value.userId,
    owner_email: identity.value.email,
    schema_version: Number.isInteger(schemaVersion) && schemaVersion > 0 ? schemaVersion : 3,
    state_payload: state,
    updated_at: new Date().toISOString(),
  };
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${TABLE_NAME}?on_conflict=owner_id`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(row),
      cache: "no-store",
    },
  );
  const body = await readJson(response);
  if (!response.ok) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_LAUNCH_TRACKER_WRITE_FAILED",
        message: readErrorMessage(body, response.status),
      },
      { status: 500 },
    );
  }

  const saved = Array.isArray(body) ? body[0] : null;
  return Response.json({
    ok: true,
    updatedAt: saved?.updated_at ?? row.updated_at,
    schemaVersion: row.schema_version,
  });
}

function normalizeStatePayload(value: unknown): TrackerStatePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("진행관리 state 객체가 필요합니다.");
  }
  const state = value as TrackerStatePayload;
  if (!Array.isArray(state.items)) {
    throw new Error("진행관리 상품 목록(items)이 필요합니다.");
  }
  if (state.items.length > MAX_ITEM_COUNT) {
    throw new Error(`진행관리 상품은 최대 ${MAX_ITEM_COUNT.toLocaleString("ko-KR")}건까지 저장할 수 있습니다.`);
  }
  const serialized = JSON.stringify(state);
  if (new TextEncoder().encode(serialized).byteLength > MAX_STATE_BYTES) {
    throw new Error("진행관리 데이터 크기가 8MB를 초과했습니다. 상세페이지 원본 이미지는 URL로 연결하세요.");
  }
  return JSON.parse(serialized) as TrackerStatePayload;
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
        if (!item || typeof item !== "object" || Array.isArray(item)) return true;
        const id = String((item as { id?: unknown }).id ?? "").trim();
        return !id || !deletedIds.has(id);
      })
    : [];

  return normalizeStatePayload({
    ...incoming,
    serverDeletedItemIds: [...deletedIds],
    items,
  });
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => String(entry ?? "").trim()).filter(Boolean))];
}

async function readExistingState(
  supabaseUrl: string,
  secretKey: string,
  ownerId: string,
): Promise<
  | { ok: true; state: TrackerStatePayload | null }
  | { ok: false; message: string }
> {
  const params = new URLSearchParams({
    select: "state_payload",
    owner_id: `eq.${ownerId}`,
    limit: "1",
  });
  const response = await fetch(
    `${supabaseUrl}/rest/v1/${TABLE_NAME}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(secretKey),
      cache: "no-store",
    },
  );
  const body = await readJson(response);
  if (!response.ok) {
    return { ok: false, message: readErrorMessage(body, response.status) };
  }
  const row = Array.isArray(body) ? body[0] : null;
  const state = row?.state_payload;
  return {
    ok: true,
    state:
      state && typeof state === "object" && !Array.isArray(state)
        ? (state as TrackerStatePayload)
        : null,
  };
}

async function resolveTrackerIdentity(
  request: NextRequest,
): Promise<
  | { ok: true; value: TrackerIdentity }
  | { ok: false; status: number; body: { ok: false; code: string; message: string } }
> {
  if (isOpsLoginTemporarilyDisabled()) {
    if (!isSameOriginOpsRequest(request)) {
      return {
        ok: false,
        status: 403,
        body: {
          ok: false,
          code: "SAME_ORIGIN_REQUIRED",
          message: "OPS Center 화면에서만 진행관리 데이터를 읽을 수 있습니다.",
        },
      };
    }
    const identity = temporaryOpsIdentity();
    return { ok: true, value: identity };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      ok: false,
      status: 503,
      body: {
        ok: false,
        code: "SUPABASE_NOT_CONFIGURED",
        message: "Supabase 서버 연결이 설정되지 않았습니다.",
      },
    };
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return {
      ok: false,
      status: 401,
      body: {
        ok: false,
        code: "AUTH_REQUIRED",
        message: "진행관리 데이터를 사용하려면 로그인해야 합니다.",
      },
    };
  }
  return {
    ok: true,
    value: {
      userId: data.user.id,
      email: data.user.email?.toLowerCase() ?? "",
    },
  };
}

function getAdminConfig():
  | { ok: true; supabaseUrl: string; secretKey: string }
  | { ok: false; body: { ok: false; code: string; message: string } } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secretKey = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!supabaseUrl || !secretKey) {
    return {
      ok: false,
      body: {
        ok: false,
        code: "SUPABASE_NOT_CONFIGURED",
        message: "진행관리 서버 저장소에 필요한 Supabase 환경변수가 없습니다.",
      },
    };
  }
  return { ok: true, supabaseUrl, secretKey };
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function readErrorMessage(body: unknown, status: number) {
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return `진행관리 저장소 요청에 실패했습니다. status=${status}`;
}
