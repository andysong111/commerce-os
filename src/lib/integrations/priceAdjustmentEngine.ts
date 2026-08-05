import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const DEFAULT_PRICE_ADJUSTMENT_ENGINE_URL =
  "https://commerce-os-price-adjustment-engine.andy123df23.chatgpt.site";
const DEFAULT_PRODUCT_MASTER_URL =
  "https://commerce-os-product-master.vercel.app";

export type PriceAdjustmentRecommendation = {
  id: string;
  barcode: string;
  name: string;
  decision: string;
  risk: string;
  grade: number | null;
  seasonality: string | null;
  lifecycleStatus: string | null;
  reorderingAllowed: boolean | null;
  shadowMode: boolean;
  currentPrice: number;
  recommendedPrice: number;
  latestCost: number;
  protectionCost: number;
  protectionFloor: number;
  defaultSelected: boolean;
  reasons: string[];
};

export type PriceAdjustmentDashboard = {
  mode: string;
  notice: string;
  run: {
    id: string;
    generatedAt: string;
    status: string;
  } | null;
  summary: {
    increaseRequired: number;
    decreaseReview: number;
    discontinuedReview: number;
    hold: number;
    blocked: number;
  };
  recommendations: PriceAdjustmentRecommendation[];
};

export type PriceAdjustmentIntegrationResult = {
  dashboard: PriceAdjustmentDashboard;
  sourceMode:
    | "product_master_lifecycle"
    | "ops_ledger"
    | "legacy_site"
    | "empty";
  sourceHost: string;
  writesEnabled: false;
  error: string | null;
};

type OperationRow = {
  id?: unknown;
  operation_type?: unknown;
  source?: unknown;
  status?: unknown;
  started_at?: unknown;
  result_snapshot?: unknown;
  error_message?: unknown;
};

type LifecycleRow = {
  skuId?: unknown;
  barcode?: unknown;
  grade?: unknown;
  basePrice?: unknown;
  rawTargetPrice?: unknown;
  targetPrice?: unknown;
  protectionFloor?: unknown;
  clearanceStage?: unknown;
  lifecycleStatus?: unknown;
  reorderingAllowed?: unknown;
  discontinued?: unknown;
  seasonality?: unknown;
  historyMonths?: unknown;
  lastAction?: unknown;
  gradeReason?: unknown;
  calculatedAt?: unknown;
  shadowMode?: unknown;
};

type LifecyclePayload = {
  ok?: boolean;
  generatedAt?: string;
  shadowMode?: boolean;
  lifecycles?: LifecycleRow[];
  message?: string;
  error?: string;
};

function isPriceOperation(row: OperationRow) {
  const identity = `${String(row.operation_type ?? "")} ${String(row.source ?? "")}`
    .toUpperCase();
  return identity.includes("PRICE") || identity.includes("MARGIN");
}

function emptyDashboard(notice: string): PriceAdjustmentDashboard {
  return {
    mode: "EMPTY",
    notice,
    run: null,
    summary: {
      increaseRequired: 0,
      decreaseReview: 0,
      discontinuedReview: 0,
      hold: 0,
      blocked: 0,
    },
    recommendations: [],
  };
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function signedInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(-4, Math.min(6, Math.round(parsed)))
    : 0;
}

function nullableNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function decisionForLifecycle(row: LifecycleRow) {
  const grade = signedInteger(row.grade);
  const status = String(row.lifecycleStatus ?? "").toUpperCase();
  if (Boolean(row.discontinued) || grade <= -4 || status.includes("DISCONT")) {
    return "discontinued_review";
  }
  if (grade === -3 || status.includes("CLEARANCE")) {
    return "decrease_review";
  }
  if (grade > 0) return "increase_required";
  return "hold";
}

function lifecycleDashboard(payload: LifecyclePayload): PriceAdjustmentDashboard {
  const rows = Array.isArray(payload.lifecycles) ? payload.lifecycles : [];
  const recommendations: PriceAdjustmentRecommendation[] = rows.map(
    (row, index) => {
      const decision = decisionForLifecycle(row);
      const protectionFloor = number(row.protectionFloor);
      const grade = signedInteger(row.grade);
      return {
        id: String(row.skuId ?? `lifecycle-${index}`),
        barcode: String(row.barcode ?? ""),
        name: String(row.barcode ?? "상품명 미연결"),
        decision,
        risk: Boolean(row.shadowMode) ? "shadow" : "verified",
        grade,
        seasonality: String(row.seasonality ?? "") || null,
        lifecycleStatus: String(row.lifecycleStatus ?? "") || null,
        reorderingAllowed:
          typeof row.reorderingAllowed === "boolean"
            ? row.reorderingAllowed
            : null,
        shadowMode: Boolean(row.shadowMode),
        currentPrice: number(row.basePrice),
        recommendedPrice: number(row.targetPrice || row.rawTargetPrice),
        latestCost: 0,
        protectionCost: protectionFloor
          ? Math.round(protectionFloor / 2)
          : 0,
        protectionFloor,
        defaultSelected:
          !Boolean(row.shadowMode) && decision === "increase_required",
        reasons: [
          String(row.gradeReason ?? "").trim(),
          String(row.lastAction ?? "").trim(),
          `판매이력 ${number(row.historyMonths)}개월`,
        ].filter(Boolean),
      };
    },
  );
  const count = (decision: string) =>
    recommendations.filter((row) => row.decision === decision).length;
  const generatedAt =
    payload.generatedAt && Number.isFinite(Date.parse(payload.generatedAt))
      ? new Date(payload.generatedAt).toISOString()
      : new Date().toISOString();

  return {
    mode: payload.shadowMode ? "PRODUCT_MASTER_SHADOW" : "PRODUCT_MASTER",
    notice: payload.shadowMode
      ? "상품마스터의 안정 SKU 상품등급 원장을 그림자 모드로 읽습니다. 실제 가격에는 반영하지 않습니다."
      : "상품마스터의 안정 SKU 상품등급 원장을 읽습니다. 실제 가격변경은 별도 안전 실행기를 사용합니다.",
    run: {
      id: `product-master-lifecycle:${generatedAt}`,
      generatedAt,
      status: payload.shadowMode ? "SHADOW" : "READY",
    },
    summary: {
      increaseRequired: count("increase_required"),
      decreaseReview: count("decrease_review"),
      discontinuedReview: count("discontinued_review"),
      hold: count("hold"),
      blocked: count("blocked"),
    },
    recommendations,
  };
}

function normalizeDashboard(value: unknown): PriceAdjustmentDashboard {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("가격조정 대시보드 응답 형식이 올바르지 않습니다.");
  }
  const row = value as Record<string, unknown>;
  const summary =
    row.summary && typeof row.summary === "object" && !Array.isArray(row.summary)
      ? (row.summary as Record<string, unknown>)
      : {};
  const run =
    row.run && typeof row.run === "object" && !Array.isArray(row.run)
      ? (row.run as Record<string, unknown>)
      : null;
  const recommendations = Array.isArray(row.recommendations)
    ? row.recommendations.map((value, index) => {
        const item =
          value && typeof value === "object" && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {};
        return {
          id: String(item.id ?? `price-${index}`),
          barcode: String(item.barcode ?? ""),
          name: String(item.name ?? item.barcode ?? "상품명 없음"),
          decision: String(item.decision ?? "hold"),
          risk: String(item.risk ?? "unknown"),
          grade: nullableNumber(item.grade),
          seasonality: String(item.seasonality ?? "") || null,
          lifecycleStatus: String(item.lifecycleStatus ?? "") || null,
          reorderingAllowed:
            typeof item.reorderingAllowed === "boolean"
              ? item.reorderingAllowed
              : null,
          shadowMode: Boolean(item.shadowMode),
          currentPrice: number(item.currentPrice),
          recommendedPrice: number(item.recommendedPrice),
          latestCost: number(item.latestCost),
          protectionCost: number(item.protectionCost),
          protectionFloor: number(item.protectionFloor),
          defaultSelected: Boolean(item.defaultSelected),
          reasons: stringArray(item.reasons),
        } satisfies PriceAdjustmentRecommendation;
      })
    : [];

  return {
    mode: String(row.mode ?? "LIVE"),
    notice: String(row.notice ?? "가격조정 결과를 읽었습니다."),
    run: run
      ? {
          id: String(run.id ?? ""),
          generatedAt: String(run.generatedAt ?? ""),
          status: String(run.status ?? "UNKNOWN"),
        }
      : null,
    summary: {
      increaseRequired: number(summary.increaseRequired),
      decreaseReview: number(summary.decreaseReview),
      discontinuedReview: number(summary.discontinuedReview),
      hold: number(summary.hold),
      blocked: number(summary.blocked),
    },
    recommendations,
  };
}

async function loadProductMasterLifecycle() {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  if (!secret) return { dashboard: null, error: null };
  const baseUrl = (
    process.env.PRODUCT_MASTER_BASE_URL?.trim() || DEFAULT_PRODUCT_MASTER_URL
  ).replace(/\/$/, "");
  try {
    const response = await fetch(
      `${baseUrl}/api/integrations/lifecycle-snapshot`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-commerce-os-integration-secret": secret,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as LifecyclePayload;
    if (
      !response.ok ||
      payload.ok !== true ||
      !Array.isArray(payload.lifecycles)
    ) {
      throw new Error(
        payload.message ||
          payload.error ||
          `상품마스터 상품등급 조회 실패 · HTTP ${response.status}`,
      );
    }
    if (!payload.lifecycles.length) return { dashboard: null, error: null };
    return { dashboard: lifecycleDashboard(payload), error: null };
  } catch (error) {
    return {
      dashboard: null,
      error:
        error instanceof Error
          ? error.message
          : "상품마스터 상품등급 원장을 읽지 못했습니다.",
    };
  }
}

async function loadInternalLedgerStatus() {
  const admin = await createSupabaseAdminClient();
  if (!admin) return null;
  const result = await admin
    .from("commerce_operation_runs")
    .select(
      "id,operation_type,source,status,started_at,result_snapshot,error_message",
    )
    .order("started_at", { ascending: false })
    .limit(200);
  if (result.error) throw new Error(result.error.message);
  const row = (Array.isArray(result.data) ? result.data : [])
    .filter((value): value is OperationRow =>
      Boolean(value && typeof value === "object"),
    )
    .find(isPriceOperation);
  if (!row) return null;
  const snapshot = row.result_snapshot;
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    try {
      return normalizeDashboard(snapshot);
    } catch {
      // 실행 원장의 결과가 대시보드 형식이 아니면 상태 요약으로 표시한다.
    }
  }
  return {
    ...emptyDashboard(
      row.error_message
        ? `최근 가격조정 원장 오류: ${String(row.error_message)}`
        : "최근 가격조정 실행 원장을 Ops Center에서 확인했습니다.",
    ),
    mode: "OPS_LEDGER",
    run: {
      id: String(row.id ?? ""),
      generatedAt: String(row.started_at ?? ""),
      status: String(row.status ?? "UNKNOWN"),
    },
  } satisfies PriceAdjustmentDashboard;
}

export async function loadPriceAdjustmentDashboard(): Promise<PriceAdjustmentIntegrationResult> {
  const lifecycle = await loadProductMasterLifecycle();
  if (lifecycle.dashboard) {
    return {
      dashboard: lifecycle.dashboard,
      sourceMode: "product_master_lifecycle",
      sourceHost: "Product Master 안정 SKU 상품등급 원장",
      writesEnabled: false,
      error: null,
    };
  }

  try {
    const internal = await loadInternalLedgerStatus();
    if (internal) {
      return {
        dashboard: internal,
        sourceMode: "ops_ledger",
        sourceHost: "Ops Center Supabase 실행원장",
        writesEnabled: false,
        error: lifecycle.error,
      };
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "내부 가격조정 원장 조회 실패";
    return {
      dashboard: emptyDashboard("내부 가격조정 원장을 읽지 못했습니다."),
      sourceMode: "empty",
      sourceHost: "Ops Center Supabase 실행원장",
      writesEnabled: false,
      error: [lifecycle.error, message].filter(Boolean).join(" / "),
    };
  }

  const baseUrl = (
    process.env.PRICE_ADJUSTMENT_ENGINE_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_PRICE_ADJUSTMENT_ENGINE_URL?.trim() ||
    DEFAULT_PRICE_ADJUSTMENT_ENGINE_URL
  ).replace(/\/$/, "");

  try {
    const response = await fetch(`${baseUrl}/api/dashboard`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      throw new Error(
        `기존 가격조정 대시보드 조회 실패 · HTTP ${response.status}`,
      );
    }
    return {
      dashboard: normalizeDashboard(await response.json()),
      sourceMode: "legacy_site",
      sourceHost: new URL(baseUrl).host,
      writesEnabled: false,
      error: lifecycle.error,
    };
  } catch (error) {
    return {
      dashboard: emptyDashboard("가격조정 내부 이전 준비 중입니다."),
      sourceMode: "empty",
      sourceHost: "Ops Center 내부 이전 준비",
      writesEnabled: false,
      error: [
        lifecycle.error,
        error instanceof Error
          ? error.message
          : "가격조정 데이터를 불러오지 못했습니다.",
      ]
        .filter(Boolean)
        .join(" / "),
    };
  }
}
