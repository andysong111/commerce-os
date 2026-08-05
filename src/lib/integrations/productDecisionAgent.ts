const DEFAULT_PRODUCT_DECISION_AGENT_BASE_URL =
  "https://commerce-os-product-decision-agent.andy123df23.chatgpt.site";

export type ProductDecisionScore = {
  total?: number;
};

export type ProductDecisionRow = {
  barcode?: string;
  name?: string;
  modelNo?: string | null;
  status?: string;
  trend?: string;
  recommendedQty?: number;
  rawRecommendedQty?: number;
  forecastUnits?: number;
  expectedCost?: number;
  estimatedStock?: number;
  openCommitment?: number;
  securedQuantity?: number;
  netRequiredRaw?: number;
  inventoryKnown?: boolean;
  score?: ProductDecisionScore;
};

export type ProductDecisionSnapshot = {
  mode?: "DEMO" | "LIVE";
  notice?: string;
  runId?: string;
  runStatus?: string;
  generatedAt?: string;
  periodLabel?: string;
  budget?: number;
  budgetBasis?: string;
  expectedSpend?: number;
  products?: ProductDecisionRow[];
};

export type ProductDecisionIntegrationResult = {
  snapshot: ProductDecisionSnapshot;
  error: string | null;
  sourceHost: string;
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

export async function loadProductDecisionSnapshot(): Promise<ProductDecisionIntegrationResult> {
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
      writesEnabled: false,
    };
  } catch (error) {
    return {
      snapshot: emptySnapshot(),
      error:
        error instanceof Error
          ? error.message
          : "기존 발주 추천 데이터를 불러오지 못했습니다.",
      sourceHost,
      writesEnabled: false,
    };
  }
}
