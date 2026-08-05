import { openChinaOrderCommitmentsByBarcode } from "@/lib/chinaOrderLedger";
import {
  applyProductDecisionLiveOverlay,
  type ProductDecisionInventoryRow,
  type ProductDecisionLiveOverlaySummary,
} from "@/lib/productDecisionLiveOverlay";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  type ProductDecisionRow,
  type ProductDecisionScore,
  type ProductDecisionSnapshot,
} from "@/lib/productDecisionSnapshot";

export type { ProductDecisionRow, ProductDecisionScore, ProductDecisionSnapshot };

const DEFAULT_PRODUCT_DECISION_AGENT_BASE_URL =
  "https://commerce-os-product-decision-agent.andy123df23.chatgpt.site";
const DEFAULT_PRODUCT_MASTER_BASE_URL =
  "https://commerce-os-product-master.vercel.app";
const PRODUCT_DECISION_SNAPSHOT_OPERATION =
  "PRODUCT_DECISION_SNAPSHOT_IMPORT";

export type ProductDecisionIntegrationResult = {
  snapshot: ProductDecisionSnapshot;
  error: string | null;
  sourceHost: string;
  sourceMode:
    | "internal_live_overlay"
    | "internal_snapshot"
    | "legacy_site";
  writesEnabled: false;
  liveOverlay: ProductDecisionLiveOverlaySummary;
};

type InventoryPayload = {
  ok?: boolean;
  generatedAt?: string;
  inventories?: Array<{
    barcode?: unknown;
    estimatedQuantity?: unknown;
    confirmed?: unknown;
    requiresReview?: unknown;
  }>;
  message?: string;
  error?: string;
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

function emptyOverlay(
  inventoryError: string | null = null,
  commitmentError: string | null = null,
): ProductDecisionLiveOverlaySummary {
  return {
    applied: Boolean(inventoryError || commitmentError),
    productCount: 0,
    confirmedInventoryCount: 0,
    commitmentBarcodeCount: 0,
    changedProductCount: 0,
    zeroNeedCount: 0,
    inventoryGeneratedAt: null,
    inventoryError,
    commitmentError,
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

async function loadProductMasterInventory(): Promise<{
  rows: ProductDecisionInventoryRow[];
  generatedAt: string | null;
  error: string | null;
}> {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  if (!secret) {
    return {
      rows: [],
      generatedAt: null,
      error: "상품마스터 연동키가 없어 최신 확인재고를 덧씌우지 못했습니다.",
    };
  }
  const baseUrl = (
    process.env.PRODUCT_MASTER_BASE_URL?.trim() ||
    DEFAULT_PRODUCT_MASTER_BASE_URL
  ).replace(/\/$/, "");

  try {
    const response = await fetch(
      `${baseUrl}/api/integrations/inventory-snapshot`,
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
    const payload = (await response.json().catch(() => ({}))) as InventoryPayload;
    if (
      !response.ok ||
      payload.ok !== true ||
      !Array.isArray(payload.inventories)
    ) {
      throw new Error(
        payload.message ||
          payload.error ||
          `상품마스터 재고 조회 실패 · HTTP ${response.status}`,
      );
    }

    return {
      rows: payload.inventories.map((row) => ({
        barcode: String(row.barcode ?? ""),
        estimatedQuantity: Number(row.estimatedQuantity ?? 0),
        confirmed: Boolean(row.confirmed),
        requiresReview: Boolean(row.requiresReview),
      })),
      generatedAt:
        payload.generatedAt && Number.isFinite(Date.parse(payload.generatedAt))
          ? new Date(payload.generatedAt).toISOString()
          : null,
      error: null,
    };
  } catch (error) {
    return {
      rows: [],
      generatedAt: null,
      error:
        error instanceof Error
          ? error.message
          : "상품마스터 최신 확인재고를 읽지 못했습니다.",
    };
  }
}

async function applyLiveOverlay(snapshot: ProductDecisionSnapshot) {
  const [inventory, commitment] = await Promise.all([
    loadProductMasterInventory(),
    openChinaOrderCommitmentsByBarcode(),
  ]);
  return applyProductDecisionLiveOverlay(
    snapshot,
    inventory.rows,
    commitment.commitments,
    {
      inventoryGeneratedAt: inventory.generatedAt,
      inventoryError: inventory.error,
      commitmentError: commitment.error,
    },
  );
}

export async function loadProductDecisionSnapshot(): Promise<ProductDecisionIntegrationResult> {
  const internal = await loadInternalSnapshot();
  if (internal.snapshot) {
    const overlaid = await applyLiveOverlay(internal.snapshot);
    return {
      snapshot: overlaid.snapshot,
      error: null,
      sourceHost:
        "Ops Center 검증 수요 · Product Master 확인재고 · 중국 미입고 원장",
      sourceMode: overlaid.summary.applied
        ? "internal_live_overlay"
        : "internal_snapshot",
      writesEnabled: false,
      liveOverlay: overlaid.summary,
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
    const snapshot = normalizeSnapshot(await response.json());

    return {
      snapshot,
      error: null,
      sourceHost,
      sourceMode: "legacy_site",
      writesEnabled: false,
      liveOverlay: emptyOverlay(),
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
      liveOverlay: emptyOverlay(),
    };
  }
}
