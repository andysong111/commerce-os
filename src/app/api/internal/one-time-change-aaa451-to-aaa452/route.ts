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

  const rowResult = await readTrackerRow(config.supabaseUrl, config.secretKey);
  if (!rowResult.ok) {
    return Response.json(rowResult.body, { status: rowResult.status });
  }

  const { row, state, items } = rowResult;
  const targetEntries = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isExactProduct(item, CURRENT_MODEL));
  const nextModelEntries = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => normalizeModelNumber(item.modelNumber) === NEXT_MODEL);
  const duplicateMergeReady =
    targetEntries.length === 1 &&
    nextModelEntries.length === 1 &&
    sameDuplicateIdentity(targetEntries[0].item, nextModelEntries[0].item);
  const plannedAction =
    targetEntries.length !== 1
      ? "blocked_target_count"
      : nextModelEntries.length === 0
        ? "rename"
        : duplicateMergeReady
          ? "merge_duplicate_keep_existing_aaa452"
          : "blocked_aaa452_conflict";
  const report = {
    sourceUpdatedAt: String(row.updated_at ?? ""),
    totalItems: items.length,
    currentExactCount: targetEntries.length,
    nextModelCount: nextModelEntries.length,
    duplicateMergeReady,
    plannedAction,
    currentTargets: targetEntries.map(({ item }) => summarize(item)),
    nextModelItems: nextModelEntries.map(({ item }) => summarize(item)),
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
  if (targetEntries.length !== 1) {
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

  const updatedAt = new Date().toISOString();
  let nextItems: TrackerItem[];
  let nextDeletedIds = stringArray(state.serverDeletedItemIds);
  let action: "renamed" | "merged_duplicate";

  if (nextModelEntries.length === 0) {
    const targetIndex = targetEntries[0].index;
    nextItems = items.map((item, index) =>
      index === targetIndex
        ? {
            ...item,
            modelNumber: NEXT_MODEL,
            productName: PRODUCT_NAME,
            updatedAt,
            updatedBy: "승준",
          }
        : item,
    );
    action = "renamed";
  } else if (duplicateMergeReady) {
    const target = targetEntries[0];
    const canonical = nextModelEntries[0];
    const targetId = String(target.item.id ?? "").trim();
    const merged = mergeDuplicateItem(canonical.item, target.item, updatedAt);
    nextItems = items.flatMap((item, index) => {
      if (index === target.index) return [];
      if (index === canonical.index) return [merged];
      return [item];
    });
    nextDeletedIds = [...new Set([...nextDeletedIds, targetId].filter(Boolean))];
    action = "merged_duplicate";
  } else {
    return Response.json(
      {
        ok: false,
        code: "AAA452_CONFLICT_NOT_EQUIVALENT",
        message: "AAA452가 이미 사용 중이며 동일 중복 행으로 확정할 수 없어 변경하지 않았습니다.",
        ...report,
      },
      { status: 409 },
    );
  }

  const nextState = {
    ...state,
    schemaVersion: Number(state.schemaVersion ?? row.schema_version ?? 3),
    savedAt: updatedAt,
    items: nextItems,
    serverDeletedItemIds: nextDeletedIds,
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
    action,
    from: CURRENT_MODEL,
    to: NEXT_MODEL,
    productName: PRODUCT_NAME,
    totalBefore: items.length,
    totalAfter: nextItems.length,
    updatedAt,
  });
}

function isExactProduct(item: TrackerItem, modelNumber: string) {
  return (
    normalizeModelNumber(item.modelNumber) === modelNumber &&
    normalizeProductName(item.productName) === normalizeProductName(PRODUCT_NAME)
  );
}

function sameDuplicateIdentity(left: TrackerItem, right: TrackerItem) {
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftBarcode = String(leftRecord.barcode ?? "").trim().toUpperCase();
  const rightBarcode = String(rightRecord.barcode ?? "").trim().toUpperCase();
  return (
    normalizeProductName(left.productName) === normalizeProductName(right.productName) &&
    Boolean(leftBarcode && rightBarcode && leftBarcode === rightBarcode) &&
    JSON.stringify(readSaleOptions(leftRecord.orderOptions)) ===
      JSON.stringify(readSaleOptions(rightRecord.orderOptions))
  );
}

function mergeDuplicateItem(
  canonicalItem: TrackerItem,
  duplicateItem: TrackerItem,
  updatedAt: string,
) {
  const canonical = canonicalItem as Record<string, unknown>;
  const duplicate = duplicateItem as Record<string, unknown>;
  return {
    ...duplicate,
    ...canonical,
    modelNumber: NEXT_MODEL,
    productName: PRODUCT_NAME,
    barcode:
      String(canonical.barcode ?? "").trim() ||
      String(duplicate.barcode ?? "").trim(),
    orderOptions:
      Array.isArray(canonical.orderOptions) && canonical.orderOptions.length
        ? canonical.orderOptions
        : duplicate.orderOptions,
    shoplingProducts: mergeShoplingProducts(
      duplicate.shoplingProducts,
      canonical.shoplingProducts,
    ),
    stages: mergeStages(canonical.stages, duplicate.stages),
    source: mergeSource(canonical.source, duplicate.source),
    notes: mergeText(duplicate.notes, canonical.notes),
    updatedAt,
    updatedBy: "승준",
  };
}

function mergeShoplingProducts(duplicateValue: unknown, canonicalValue: unknown) {
  const duplicate = asRecord(duplicateValue);
  const canonical = asRecord(canonicalValue);
  const keys = new Set([...Object.keys(duplicate), ...Object.keys(canonical)]);
  return Object.fromEntries(
    [...keys].map((key) => {
      const left = asRecord(duplicate[key]);
      const right = asRecord(canonical[key]);
      return [
        key,
        {
          ...left,
          ...right,
          goodsKey:
            String(right.goodsKey ?? "").trim() ||
            String(left.goodsKey ?? "").trim(),
        },
      ];
    }),
  );
}

function mergeStages(canonicalValue: unknown, duplicateValue: unknown) {
  const canonical = asRecord(canonicalValue);
  const duplicate = asRecord(duplicateValue);
  const keys = new Set([...Object.keys(duplicate), ...Object.keys(canonical)]);
  return Object.fromEntries(
    [...keys].map((key) => {
      const left = asRecord(canonical[key]);
      const right = asRecord(duplicate[key]);
      return [
        key,
        stageRank(left.status) >= stageRank(right.status)
          ? { ...right, ...left }
          : { ...left, ...right },
      ];
    }),
  );
}

function mergeSource(canonicalValue: unknown, duplicateValue: unknown) {
  const canonical = asRecord(canonicalValue);
  const duplicate = asRecord(duplicateValue);
  return {
    ...duplicate,
    ...canonical,
    rows: uniqueUnknownValues(duplicate.rows, canonical.rows),
    sheetRowRefs: uniqueUnknownValues(
      duplicate.sheetRowRefs,
      canonical.sheetRowRefs,
    ),
  };
}

function mergeText(leftValue: unknown, rightValue: unknown) {
  const values = [leftValue, rightValue]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  return [...new Set(values)].join(" · ");
}

function readSaleOptions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((option) => {
      const record = asRecord(option);
      return `${String(record.saleOption ?? "").trim()}|${String(record.barcode ?? "").trim().toUpperCase()}`;
    })
    .sort();
}

function summarize(item: TrackerItem) {
  const candidate = item as Record<string, unknown>;
  const orderOptions = Array.isArray(candidate.orderOptions)
    ? candidate.orderOptions.map((option) => {
        const value = asRecord(option);
        return {
          saleOption: String(value.saleOption ?? ""),
          barcode: String(value.barcode ?? ""),
          sourceOrderItemId: value.sourceOrderItemId ?? null,
        };
      })
    : [];
  const shoplingProducts = Object.fromEntries(
    Object.entries(asRecord(candidate.shoplingProducts)).map(([key, value]) => {
      const product = asRecord(value);
      return [key, String(product.goodsKey ?? "")];
    }),
  );
  const stages = Object.fromEntries(
    Object.entries(asRecord(candidate.stages)).map(([key, value]) => {
      const stage = asRecord(value);
      return [key, String(stage.status ?? "")];
    }),
  );

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

function normalizeProductName(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, " ");
}

function stageRank(value: unknown) {
  return (
    {
      미시작: 0,
      "진행 중": 1,
      보류: 2,
      완료: 3,
      제외: 3,
    }[String(value ?? "").trim()] ?? -1
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function uniqueUnknownValues(...values: unknown[]) {
  return [
    ...new Set(
      values.flatMap((value) => (Array.isArray(value) ? value : [])),
    ),
  ];
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => String(entry ?? "").trim()).filter(Boolean))];
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
