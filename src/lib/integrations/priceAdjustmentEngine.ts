import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const DEFAULT_PRICE_ADJUSTMENT_ENGINE_URL =
  "https://commerce-os-price-adjustment-engine.andy123df23.chatgpt.site";

export type PriceAdjustmentRecommendation = {
  id: string;
  barcode: string;
  name: string;
  decision: string;
  risk: string;
  currentPrice: number;
  recommendedPrice: number;
  latestCost: number;
  protectionCost: number;
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
  sourceMode: "ops_ledger" | "legacy_site" | "empty";
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

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
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
          currentPrice: number(item.currentPrice),
          recommendedPrice: number(item.recommendedPrice),
          latestCost: number(item.latestCost),
          protectionCost: number(item.protectionCost),
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
    .filter((value): value is OperationRow => Boolean(value && typeof value === "object"))
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
  try {
    const internal = await loadInternalLedgerStatus();
    if (internal) {
      return {
        dashboard: internal,
        sourceMode: "ops_ledger",
        sourceHost: "Ops Center Supabase 실행원장",
        writesEnabled: false,
        error: null,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "내부 가격조정 원장 조회 실패";
    return {
      dashboard: emptyDashboard("내부 가격조정 원장을 읽지 못했습니다."),
      sourceMode: "empty",
      sourceHost: "Ops Center Supabase 실행원장",
      writesEnabled: false,
      error: message,
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
      throw new Error(`기존 가격조정 대시보드 조회 실패 · HTTP ${response.status}`);
    }
    return {
      dashboard: normalizeDashboard(await response.json()),
      sourceMode: "legacy_site",
      sourceHost: new URL(baseUrl).host,
      writesEnabled: false,
      error: null,
    };
  } catch (error) {
    return {
      dashboard: emptyDashboard("가격조정 내부 이전 준비 중입니다."),
      sourceMode: "empty",
      sourceHost: "Ops Center 내부 이전 준비",
      writesEnabled: false,
      error:
        error instanceof Error
          ? error.message
          : "가격조정 데이터를 불러오지 못했습니다.",
    };
  }
}
