import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

const TABLE_NAME = "product_launch_tracker_states";
const OWNER_ID = "0c23a96b-1cda-44b6-9c08-1fa1c1b45a36";
const OWNER_EMAIL = "andy0801a@gmail.com";
const APPLY_TOKEN = "goBlJhUtP29OOZq6paVX5-vuBF0dHIoSLQrXNVzEfeM";

const UPDATES = [
  {
    "modelNumber": "AAA448",
    "productName": "책상정리 미니서랍 화이트",
    "options": [
      "1단",
      "2단",
      "3단"
    ]
  },
  {
    "modelNumber": "AAA449",
    "productName": "투명 굿즈서랍 수납함",
    "options": [
      "화이트",
      "핑크",
      "블루"
    ]
  },
  {
    "modelNumber": "AAA446",
    "productName": "볼펜꽂이 미니 가죽노트",
    "options": [
      "하늘",
      "블랙",
      "그레이",
      "그린",
      "네이비",
      "핑크",
      "브라운",
      "전용미니펜 5자루"
    ]
  },
  {
    "modelNumber": "AAA484",
    "productName": "크루아상 쿠션",
    "options": [
      "단품"
    ]
  },
  {
    "modelNumber": "AAA479",
    "productName": "헤드레스트 스웨이드 후크",
    "options": [
      "브라운",
      "블랙",
      "그레이"
    ]
  },
  {
    "modelNumber": "AAA467",
    "productName": "모자세탁망 색상랜덤",
    "options": [
      "색상랜덤 발송"
    ]
  },
  {
    "modelNumber": "AAA465",
    "productName": "쿨수건 원형파우치포함",
    "options": [
      "블루",
      "핑크"
    ]
  },
  {
    "modelNumber": "AAA465",
    "productName": "쿨수건 사각파우치포함",
    "options": [
      "블루",
      "핑크"
    ]
  },
  {
    "modelNumber": "AAA471",
    "productName": "사각 샤워헤드기 블랙",
    "options": [
      "단품"
    ]
  },
  {
    "modelNumber": "AAA473",
    "productName": "스타트버튼 배트맨커버 블랙",
    "options": [
      "단품"
    ]
  },
  {
    "modelNumber": "AAA475",
    "productName": "실리콘 차량용핸들커버 블랙",
    "options": [
      "단품"
    ]
  },
  {
    "modelNumber": "AAA476",
    "productName": "문콕방지 실리콘 스티커 6개입",
    "options": [
      "6개입 발송"
    ]
  },
  {
    "modelNumber": "AAA477",
    "productName": "무소음 차량용 스퀴지",
    "options": [
      "단품"
    ]
  },
  {
    "modelNumber": "AAA483",
    "productName": "대형 에어 반달쿠션",
    "options": [
      "블루",
      "그레이"
    ]
  },
  {
    "modelNumber": "AAA489",
    "productName": "걸이형 모공브러쉬 블랙",
    "options": [
      "단품"
    ]
  },
  {
    "modelNumber": "AAA491",
    "productName": "발바닥 지압스텝퍼 색상랜덤",
    "options": [
      "색상랜덤 발송"
    ]
  },
  {
    "modelNumber": "AAA492",
    "productName": "미니짐볼 300g 색상랜덤",
    "options": [
      "색상랜덤 발송"
    ]
  },
  {
    "modelNumber": "AAA490",
    "productName": "걸이형 모공 롱브러쉬",
    "options": [
      "단품"
    ]
  },
  {
    "modelNumber": "AAA384",
    "productName": "스케이트보드 곰돌이",
    "options": [
      "대쉬보드형",
      "네비게이션형"
    ]
  },
  {
    "modelNumber": "AAA410",
    "productName": "곰돌이 털모자 A형",
    "options": [
      "핑크"
    ]
  },
  {
    "modelNumber": "AAA412",
    "productName": "여우귀 넥워머",
    "options": [
      "화이트"
    ]
  },
  {
    "modelNumber": "AAA413",
    "productName": "곰돌이 목도리 넥워머",
    "options": [
      "브라운",
      "베이지",
      "화이트"
    ]
  },
  {
    "modelNumber": "AAA414",
    "productName": "곰돌이 방울 털모자",
    "options": [
      "브라운",
      "베이지",
      "화이트",
      "핑크"
    ]
  },
  {
    "modelNumber": "AAA444",
    "productName": "투명 라면정리함",
    "options": [
      "단품"
    ]
  },
  {
    "modelNumber": "AAA451",
    "productName": "반자동 책갈피 3P 색상랜덤",
    "options": [
      "색상랜덤 발송"
    ]
  },
  {
    "modelNumber": "AAA455",
    "productName": "발편한 등산화",
    "options": [
      "블랙 260",
      "블랙 270",
      "블랙 280",
      "그레이 260",
      "그레이 270",
      "그레이 280",
      "카키 260",
      "카키 270",
      "카키 280"
    ]
  },
  {
    "modelNumber": "AAA456",
    "productName": "메쉬 여성운동화",
    "options": [
      "블랙 230",
      "블랙 240",
      "블랙 250",
      "핑크 230",
      "핑크 240",
      "핑크 250",
      "화이트 230",
      "화이트 240",
      "화이트 250"
    ]
  }
] as const;

type TrackerItem = {
  id?: unknown;
  modelNumber?: unknown;
  productName?: unknown;
  orderOptions?: unknown;
  options?: unknown;
  [key: string]: unknown;
};

type TrackerState = {
  schemaVersion?: unknown;
  savedAt?: unknown;
  policy?: unknown;
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

  const resolution = resolveTargets(items);
  const report = {
    requested: UPDATES.length,
    matched: resolution.matches.length,
    missing: resolution.missing,
    ambiguous: resolution.ambiguous,
    changes: resolution.matches.map((match) => ({
      modelNumber: match.update.modelNumber,
      productName: match.update.productName,
      currentOptions: readSaleOptions(match.item),
      requestedOptions: [...match.update.options],
    })),
  };

  const apply = url.searchParams.get("apply") === "1";
  if (!apply) {
    return Response.json({ ok: true, mode: "dry-run", ...report });
  }
  if (resolution.missing.length || resolution.ambiguous.length) {
    return Response.json(
      {
        ok: false,
        code: "TARGET_RESOLUTION_FAILED",
        message: "누락 또는 중복 대상이 있어 아무 것도 저장하지 않았습니다.",
        ...report,
      },
      { status: 409 },
    );
  }

  const matchByIndex = new Map(
    resolution.matches.map((match) => [match.index, match] as const),
  );
  const nextItems = items.map((item, index) => {
    const match = matchByIndex.get(index);
    if (!match) return item;
    return {
      ...item,
      options: [...match.update.options],
      orderOptions: buildOrderOptions(item, match.update.options, match.update.modelNumber),
    };
  });
  const nextState = {
    ...state,
    schemaVersion: Number(state.schemaVersion ?? row?.schema_version ?? 3),
    savedAt: new Date().toISOString(),
    items: nextItems,
  };
  const updatedAt = new Date().toISOString();
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
      { ok: false, code: "WRITE_FAILED", detail: writeBody },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    mode: "applied",
    updatedAt,
    requested: UPDATES.length,
    updated: resolution.matches.length,
    optionCount: UPDATES.reduce((sum, update) => sum + update.options.length, 0),
    missing: [],
    ambiguous: [],
  });
}

function resolveTargets(items: TrackerItem[]) {
  const matches: Array<{
    index: number;
    item: TrackerItem;
    update: (typeof UPDATES)[number];
  }> = [];
  const missing: Array<{ modelNumber: string; productName: string }> = [];
  const ambiguous: Array<{
    modelNumber: string;
    productName: string;
    candidateNames: string[];
  }> = [];

  for (const update of UPDATES) {
    const modelMatches = items
      .map((item, index) => ({ item, index }))
      .filter((entry) => normalizeModel(entry.item.modelNumber) === update.modelNumber);
    const exact = modelMatches.filter(
      (entry) => normalizeName(entry.item.productName) === normalizeName(update.productName),
    );
    if (exact.length > 0) {
      for (const candidate of exact) {
        matches.push({ ...candidate, update });
      }
    } else if (modelMatches.length === 1) {
      matches.push({ ...modelMatches[0], update });
    } else if (modelMatches.length === 0) {
      missing.push({ modelNumber: update.modelNumber, productName: update.productName });
    } else {
      ambiguous.push({
        modelNumber: update.modelNumber,
        productName: update.productName,
        candidateNames: modelMatches.map((entry) => String(entry.item.productName ?? "")),
      });
    }
  }

  return { matches, missing, ambiguous };
}

function readSaleOptions(item: TrackerItem) {
  if (Array.isArray(item.orderOptions)) {
    return item.orderOptions
      .map((option) =>
        option && typeof option === "object" && "saleOption" in option
          ? String((option as { saleOption?: unknown }).saleOption ?? "").trim()
          : "",
      )
      .filter(Boolean);
  }
  return Array.isArray(item.options)
    ? item.options.map((value) => String(value).trim()).filter(Boolean)
    : [];
}

function buildOrderOptions(
  item: TrackerItem,
  options: readonly string[],
  modelNumber: string,
) {
  const existing = Array.isArray(item.orderOptions)
    ? item.orderOptions.filter(
        (value): value is Record<string, unknown> =>
          Boolean(value) && typeof value === "object" && !Array.isArray(value),
      )
    : [];

  return options.map((saleOption, index) => {
    const preserved = existing.find(
      (candidate) => String(candidate.saleOption ?? "").trim() === saleOption,
    );
    return {
      ...(preserved ?? {}),
      id: String(preserved?.id ?? `${modelNumber.toLowerCase()}-option-${index + 1}`),
      optionName: String(preserved?.optionName ?? "옵션").trim() || "옵션",
      saleOption,
      chinaOption: String(preserved?.chinaOption ?? "").trim(),
      barcode: String(preserved?.barcode ?? "").trim().toUpperCase(),
      baseSalePriceKrw: nonNegativeInteger(preserved?.baseSalePriceKrw),
      unitCostKrw: nonNegativeInteger(preserved?.unitCostKrw),
      sourceOrderItemId:
        preserved?.sourceOrderItemId === null ||
        preserved?.sourceOrderItemId === undefined
          ? null
          : String(preserved.sourceOrderItemId),
    };
  });
}

function normalizeModel(value: unknown) {
  const text = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const match = text.match(/^AAA0*(\d+)$/);
  return match ? `AAA${match[1].padStart(3, "0")}` : text;
}

function normalizeName(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function nonNegativeInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
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
        message: "Supabase 환경변수가 없습니다.",
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
