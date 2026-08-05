import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const TABLE_NAME = "product_launch_tracker_states";
const OWNER_ID = "0c23a96b-1cda-44b6-9c08-1fa1c1b45a36";
const OWNER_EMAIL = "andy0801a@gmail.com";
const APPLY_TOKEN = "iH-VtPUcpFjxIt-MQoDhO6MOyA5sCBcUCMmAowAxjfE";
const CURRENT_MODEL = "AAA451";
const NEXT_MODEL = "AAA452";
const PRODUCT_NAME = "반자동 책갈피 3P 색상랜덤";

type TrackerItem = {
  id?: unknown;
  modelNumber?: unknown;
  productName?: unknown;
  [key: string]: unknown;
};

type TrackerState = {
  schemaVersion?: unknown;
  savedAt?: unknown;
  items?: unknown;
  [key: string]: unknown;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("token") !== APPLY_TOKEN) {
    return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }

  const config = getAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: 503 });

  const rowResult = await readTrackerRow(config.supabaseUrl, config.secretKey);
  if (!rowResult.ok) {
    return Response.json(rowResult.body, { status: rowResult.status });
  }

  const { row, state, items } = rowResult;
  const targetIndexes = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isExactProduct(item, CURRENT_MODEL));
  const nextModelItems = items.filter(
    (item) => normalizeModelNumber(item.modelNumber) === NEXT_MODEL,
  );
  const report = {
    sourceUpdatedAt: String(row.updated_at ?? ""),
    totalItems: items.length,
    currentExactCount: targetIndexes.length,
    nextModelCount: nextModelItems.length,
    currentTargets: targetIndexes.map(({ item }) => summarize(item)),
    nextModelItems: nextModelItems.map(summarize),
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
        message: "사전 확인 후 진행관리 데이터가 변경되어 모델번호 변경을 중단했습니다.",
        expectedUpdatedAt,
        actualUpdatedAt: report.sourceUpdatedAt,
        ...report,
      },
      { status: 409 },
    );
  }
  if (targetIndexes.length !== 1) {
    return Response.json(
      {
        ok: false,
        code: "TARGET_COUNT_INVALID",
        message: "AAA451 반자동 책갈피 대상이 정확히 1건이 아니어서 변경하지 않았습니다.",
        ...report,
      },
      { status: 409 },
    );
  }
  if (nextModelItems.length > 0) {
    return Response.json(
      {
        ok: false,
        code: "AAA452_ALREADY_USED",
        message: "AAA452가 이미 다른 행에서 사용 중이어서 변경하지 않았습니다.",
        ...report,
      },
      { status: 409 },
    );
  }

  const targetIndex = targetIndexes[0].index;
  const updatedAt = new Date().toISOString();
  const nextItems = items.map((item, index) =>
    index === targetIndex
      ? {
          ...item,
          modelNumber: NEXT_MODEL,
          updatedAt,
          updatedBy: "승준",
        }
      : item,
  );
  const nextState = {
    ...state,
    schemaVersion: Number(state.schemaVersion ?? row.schema_version ?? 3),
    savedAt: updatedAt,
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
        owner_email: String(row.owner_email ?? OWNER_EMAIL),
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
    changed: 1,
    from: CURRENT_MODEL,
    to: NEXT_MODEL,
    productName: PRODUCT_NAME,
    updatedAt,
  });
}

function isExactProduct(item: TrackerItem, modelNumber: string) {
  return (
    normalizeModelNumber(item.modelNumber) === modelNumber &&
    String(item.productName ?? "").trim() === PRODUCT_NAME
  );
}

function summarize(item: TrackerItem) {
  const candidate = item as Record<string, unknown>;
  const orderOptions = Array.isArray(candidate.orderOptions)
    ? candidate.orderOptions.map((option) => {
        const value = option && typeof option === "object" ? option as Record<string, unknown> : {};
        return {
          saleOption: String(value.saleOption ?? ""),
          barcode: String(value.barcode ?? ""),
          sourceOrderItemId: value.sourceOrderItemId ?? null,
        };
      })
    : [];
  const shoplingProducts =
    candidate.shoplingProducts && typeof candidate.shoplingProducts === "object"
      ? Object.fromEntries(
          Object.entries(candidate.shoplingProducts as Record<string, unknown>).map(
            ([key, value]) => {
              const product = value && typeof value === "object"
                ? value as Record<string, unknown>
                : {};
              return [key, String(product.goodsKey ?? "")];
            },
          ),
        )
      : {};
  const stages =
    candidate.stages && typeof candidate.stages === "object"
      ? Object.fromEntries(
          Object.entries(candidate.stages as Record<string, unknown>).map(
            ([key, value]) => {
              const stage = value && typeof value === "object"
                ? value as Record<string, unknown>
                : {};
              return [key, String(stage.status ?? "")];
            },
          ),
        )
      : {};

  return {
    id: String(item.id ?? ""),
    modelNumber: String(item.modelNumber ?? ""),
    productName: String(item.productName ?? ""),
    workBatch: String(candidate.workBatch ?? ""),
    barcode: String(candidate.barcode ?? ""),
    selfCodeBase: String(candidate.selfCodeBase ?? ""),
    orderOptions,
    shoplingProducts,
    stages,
    source: candidate.source ?? null,
    createdAt: candidate.createdAt ?? null,
    updatedAt: candidate.updatedAt ?? null,
  };
}

function normalizeModelNumber(value: unknown) {
  const compact = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/^AAA0*(\d+)$/);
  return match ? `AAA${match[1].padStart(3, "0")}` : compact;
}

async function readTrackerRow(supabaseUrl: string, secretKey: string) {
  const params = new URLSearchParams({
    select: "owner_id,owner_email,state_payload,updated_at,schema_version",
    owner_id: `eq.${OWNER_ID}`,
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
    return {
      ok: false as const,
      status: 500,
      body: { ok: false, code: "READ_FAILED", detail: body },
    };
  }
  const row = Array.isArray(body) ? body[0] : null;
  const state = row?.state_payload as TrackerState | null;
  const items = Array.isArray(state?.items) ? (state.items as TrackerItem[]) : null;
  if (!row || !state || !items) {
    return {
      ok: false as const,
      status: 404,
      body: { ok: false, code: "STATE_NOT_FOUND" },
    };
  }
  return { ok: true as const, row, state, items };
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
