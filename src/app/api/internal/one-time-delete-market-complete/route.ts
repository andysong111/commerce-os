import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const TABLE_NAME = "product_launch_tracker_states";
const OWNER_ID = "0c23a96b-1cda-44b6-9c08-1fa1c1b45a36";
const OWNER_EMAIL = "andy0801a@gmail.com";
const APPLY_TOKEN = "bCQ8kXVsQqJDxUa7onyCEogvMcN90EoQpAY6WvF5WrQ";

type TrackerItem = {
  id?: unknown;
  modelNumber?: unknown;
  productName?: unknown;
  stages?: {
    marketRegistration?: {
      status?: unknown;
    };
  };
  [key: string]: unknown;
};

type TrackerState = {
  schemaVersion?: unknown;
  savedAt?: unknown;
  items?: unknown;
  serverDeletedItemIds?: unknown;
  [key: string]: unknown;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("token") !== APPLY_TOKEN) {
    return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }

  const config = getAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: 503 });

  const params = new URLSearchParams({
    select: "owner_id,owner_email,state_payload,updated_at,schema_version",
    owner_id: `eq.${OWNER_ID}`,
    limit: "1",
  });
  const readResponse = await fetch(
    `${config.supabaseUrl}/rest/v1/${TABLE_NAME}?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  const readBody = await readJson(readResponse);
  if (!readResponse.ok) {
    return Response.json(
      { ok: false, code: "READ_FAILED", detail: readBody },
      { status: 500 },
    );
  }

  const row = Array.isArray(readBody) ? readBody[0] : null;
  const state = row?.state_payload as TrackerState | null;
  const items = Array.isArray(state?.items) ? (state.items as TrackerItem[]) : null;
  if (!state || !items) {
    return Response.json(
      { ok: false, code: "STATE_NOT_FOUND", ownerId: OWNER_ID },
      { status: 404 },
    );
  }

  const completedItems = items.filter(isMarketRegistrationComplete);
  const report = {
    totalBefore: items.length,
    deleteCount: completedItems.length,
    remainingCount: items.length - completedItems.length,
    sourceUpdatedAt: String(row?.updated_at ?? ""),
    targets: completedItems.map((item) => ({
      id: String(item.id ?? ""),
      modelNumber: String(item.modelNumber ?? ""),
      productName: String(item.productName ?? ""),
      marketRegistrationStatus: String(
        item.stages?.marketRegistration?.status ?? "",
      ),
    })),
  };

  const apply = url.searchParams.get("apply") === "1";
  if (!apply) {
    return Response.json({ ok: true, mode: "dry-run", ...report });
  }

  const expectedUpdatedAt = url.searchParams.get("expectedUpdatedAt") ?? "";
  if (!expectedUpdatedAt || expectedUpdatedAt !== report.sourceUpdatedAt) {
    return Response.json(
      {
        ok: false,
        code: "STATE_CHANGED_SINCE_DRY_RUN",
        message: "사전 조회 후 진행관리 데이터가 변경되어 삭제를 중단했습니다.",
        expectedUpdatedAt,
        actualUpdatedAt: report.sourceUpdatedAt,
        ...report,
      },
      { status: 409 },
    );
  }

  const deletedIds = new Set(stringArray(state.serverDeletedItemIds));
  for (const item of completedItems) {
    const id = String(item.id ?? "").trim();
    if (id) deletedIds.add(id);
  }
  const nextItems = items.filter((item) => {
    const id = String(item.id ?? "").trim();
    return !isMarketRegistrationComplete(item) && (!id || !deletedIds.has(id));
  });
  const updatedAt = new Date().toISOString();
  const nextState = {
    ...state,
    schemaVersion: Number(state.schemaVersion ?? row?.schema_version ?? 3),
    savedAt: updatedAt,
    serverDeletedItemIds: [...deletedIds],
    items: nextItems,
  };

  const writeResponse = await fetch(
    `${config.supabaseUrl}/rest/v1/${TABLE_NAME}?on_conflict=owner_id`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify({
        owner_id: OWNER_ID,
        owner_email: String(row?.owner_email ?? OWNER_EMAIL),
        schema_version: Number(nextState.schemaVersion ?? 3),
        state_payload: nextState,
        updated_at: updatedAt,
      }),
      cache: "no-store",
    },
  );
  const writeBody = await readJson(writeResponse);
  if (!writeResponse.ok) {
    return Response.json(
      { ok: false, code: "WRITE_FAILED", detail: writeBody, ...report },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    mode: "applied",
    deleted: completedItems.length,
    totalBefore: items.length,
    totalAfter: nextItems.length,
    protectedDeletedIds: deletedIds.size,
    updatedAt,
    deletedItems: report.targets,
  });
}

function isMarketRegistrationComplete(item: TrackerItem) {
  return String(item.stages?.marketRegistration?.status ?? "").trim() === "완료";
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => String(entry ?? "").trim()).filter(Boolean))];
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
