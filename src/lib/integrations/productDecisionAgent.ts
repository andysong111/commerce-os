import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  type ProductDecisionRow,
  type ProductDecisionScore,
  type ProductDecisionSnapshot,
} from "@/lib/productDecisionSnapshot";

export type { ProductDecisionRow, ProductDecisionScore, ProductDecisionSnapshot };

const DEFAULT_PRODUCT_DECISION_AGENT_BASE_URL =
  "https://commerce-os-product-decision-agent.andy123df23.chatgpt.site";
const PRODUCT_DECISION_SNAPSHOT_OPERATION =
  "PRODUCT_DECISION_SNAPSHOT_IMPORT";

export type ProductDecisionIntegrationResult = {
  snapshot: ProductDecisionSnapshot;
  error: string | null;
  sourceHost: string;
  sourceMode: "internal_snapshot" | "legacy_site";
  writesEnabled: false;
};

function productDecisionBaseUrl() {
  return (
    process.env.PRODUCT_DECISION_AGENT_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_PRODUCT_DECISION_AGENT_URL?.trim() ||
    DEFAULT_PRODUCT_DECISION_AGENT_BASE_URL
  );
}

function emptySnapshot(): ProductDecisionSnapshot {
  return {
    mode: "DEMO",
    generatedAt: "-",
    periodLabel: "발주안 연결 준비 중",
    budget: 0,
    expectedSpend: 0,
    products: [],
  };
}

function safeSourceHost(baseUrl: string) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "설정 오류";
  }
}

function normalizeSnapshot(value: unknown): ProductDecisionSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("발주 추천 응답 형식이 올바르지 않습니다.");
  }

  const snapshot = value as ProductDecisionSnapshot;
  return {
    ...snapshot,
    products: Array.isArray(snapshot.products) ? snapshot.products : [],
  };
}

async function loadInternalSnapshot() {
  const admin = await createSupabaseAdminClient();
  if (!admin) return { snapshot: null, error: null };

  const result = await admin
    .from("commerce_operation_runs")
    .select("result_snapshot,started_at,source_event_id")
    .eq("operation_type", PRODUCT_DECISION_SNAPSHOT_OPERATION)
    .eq("status", "SUCCEEDED")
    .order("started_at", { ascending: false })
    .limit(1);
  if (result.error) {
    return { snapshot: null, error: result.error.message };
  }

  const row = Array.isArray(result.data) ? result.data[0] : null;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return { snapshot: null, error: null };
  }

  try {
    return {
      snapshot: normalizeSnapshot(
        (row as { result_snapshot?: unknown }).result_snapshot,
      ),
      error: null,
    };
  } catch (error) {
    return {
      snapshot: null,
      error:
        error instanceof Error
          ? error.message
          : "내부 발주 추천 스냅샷을 읽지 못했습니다.",
    };
  }
}

export async function loadProductDecisionSnapshot(): Promise<ProductDecisionIntegrationResult> {
  const internal = await loadInternalSnapshot();
  if (internal.snapshot) {
    return {
      snapshot: internal.snapshot,
      error: null,
      sourceHost: "Ops Center Supabase · 검증 D1 백업",
      sourceMode: "internal_snapshot",
      writesEnabled: false,
    };
  }

  const baseUrl = productDecisionBaseUrl();
  const sourceHost = safeSourceHost(baseUrl);

  try {
    const response = await fetch(new URL("/api/sales-dashboard", baseUrl), {
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
      signal: AbortSignal.timeout(25_000),
    });

    if (!response.ok) {
      throw new Error(`기존 발주 추천 조회 실패 · HTTP ${response.status}`);
    }

    return {
      snapshot: normalizeSnapshot(await response.json()),
      error: null,
      sourceHost,
      sourceMode: "legacy_site",
      writesEnabled: false,
    };
  } catch (error) {
    const legacyError =
      error instanceof Error
        ? error.message
        : "기존 발주 추천 데이터를 불러오지 못했습니다.";
    return {
      snapshot: emptySnapshot(),
      error: internal.error
        ? `내부 스냅샷 확인 실패 · ${internal.error} / ${legacyError}`
        : legacyError,
      sourceHost,
      sourceMode: "legacy_site",
      writesEnabled: false,
    };
  }
}
