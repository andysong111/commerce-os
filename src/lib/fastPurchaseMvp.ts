import { createHash } from "node:crypto";
import { calculateNetRequirement } from "@/lib/productDecisionEngine/netRequirement";
import type { SalesOrderGroup } from "@/lib/productDecisionEngine/salesOrder";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadCanonicalPurchaseShadow } from "@/lib/stage8CanonicalPurchaseShadow";
import { loadProvisionalInventoryDiagnostics } from "@/lib/stage8ProvisionalInventoryDiagnostics";

export type FastPurchaseMvpAction =
  | "ORDER_REVIEW"
  | "HOLD"
  | "FALLBACK_ORDER_REVIEW"
  | "FALLBACK_HOLD"
  | "MANUAL_REVIEW"
  | "DATA_HOLD";

export type FastPurchaseMvpBasis =
  | "TWO_SIDED_BAND"
  | "CUMULATIVE_UPPER_BIASED"
  | "INSUFFICIENT";

export type FastPurchaseMvpRow = {
  barcode: string;
  modelNo: string | null;
  productName: string;
  action: FastPurchaseMvpAction;
  actionLabel: string;
  basis: FastPurchaseMvpBasis;
  riskBias: "BALANCED_BAND" | "UNDER_ORDER_BIASED" | "UNKNOWN";
  recommendedQuantity: number;
  planningInventoryQuantity: number | null;
  inventoryBandLow: number | null;
  inventoryBandHigh: number | null;
  lowScenarioRecommendedQuantity: number | null;
  highScenarioRecommendedQuantity: number | null;
  reason: string;
  usableForTodayDecision: boolean;
  manualOrderOnly: true;
  automaticPurchaseEnabled: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
};

export type FastPurchaseMvpReport = {
  generatedAt: string;
  state: "READY_MVP" | "BLOCKED";
  message: string;
  evaluatedCount: number;
  orderReviewCount: number;
  holdCount: number;
  fallbackDecisionCount: number;
  manualReviewCount: number;
  dataHoldCount: number;
  usableDecisionCount: number;
  fingerprint: string;
  mode: "FAST_USE_PROVISIONAL_V2";
  manualOrderOnly: true;
  automaticPurchaseEnabled: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
  rows: FastPurchaseMvpRow[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function salesOrderGroup(value: unknown): SalesOrderGroup {
  const normalized = text(value);
  if (
    normalized === "발주 추천" ||
    normalized === "소량 검토" ||
    normalized === "발주 보류" ||
    normalized === "데이터 부족"
  ) {
    return normalized;
  }
  return "발주 보류";
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function actionPriority(action: FastPurchaseMvpAction) {
  if (action === "ORDER_REVIEW") return 0;
  if (action === "FALLBACK_ORDER_REVIEW") return 1;
  if (action === "MANUAL_REVIEW") return 2;
  if (action === "HOLD") return 3;
  if (action === "FALLBACK_HOLD") return 4;
  return 5;
}

export async function loadFastPurchaseMvp(): Promise<FastPurchaseMvpReport> {
  const [diagnostics, purchaseShadow, planning] = await Promise.all([
    loadProvisionalInventoryDiagnostics(),
    loadCanonicalPurchaseShadow(),
    loadProductPlanningSnapshot(),
  ]);
  const purchaseByBarcode = new Map(
    (purchaseShadow.snapshot?.products ?? []).map(
      (row) => [barcode(row.barcode), row] as const,
    ),
  );
  const planningByBarcode = new Map(
    planning.products
      .filter((row) => row.skuActive !== false)
      .map((row) => [barcode(row.barcode), row] as const),
  );

  const rows = diagnostics.rows
    .map((row): FastPurchaseMvpRow => {
      const common = {
        barcode: row.barcode,
        modelNo: row.modelNo,
        productName: row.productName,
        planningInventoryQuantity: null,
        inventoryBandLow: row.diagnosticLowQuantity,
        inventoryBandHigh: row.diagnosticHighQuantity,
        lowScenarioRecommendedQuantity: row.lowRecommendedQuantity,
        highScenarioRecommendedQuantity: row.highRecommendedQuantity,
        manualOrderOnly: true as const,
        automaticPurchaseEnabled: false as const,
        purchaseWritesEnabled: false as const,
        inventoryWritesEnabled: false as const,
      };

      if (
        row.state === "BAND_READY" &&
        row.decisionState === "ORDER_DIRECTION_STABLE" &&
        row.conservativeDraftRecommendedQuantity > 0
      ) {
        return {
          ...common,
          action: "ORDER_REVIEW",
          actionLabel: "발주 검토",
          basis: "TWO_SIDED_BAND",
          riskBias: "BALANCED_BAND",
          recommendedQuantity: row.conservativeDraftRecommendedQuantity,
          reason:
            "추정재고의 낮은값과 높은값 양쪽 모두 발주가 필요합니다. 두 시나리오 권장수량 중 더 작은 수량만 사용합니다.",
          usableForTodayDecision: true,
        };
      }

      if (
        row.state === "BAND_READY" &&
        row.decisionState === "HOLD_DIRECTION_STABLE"
      ) {
        return {
          ...common,
          action: "HOLD",
          actionLabel: "발주 보류",
          basis: "TWO_SIDED_BAND",
          riskBias: "BALANCED_BAND",
          recommendedQuantity: 0,
          reason:
            "추정재고의 낮은값과 높은값 양쪽 모두에서 신규 발주가 필요하지 않아 오늘은 보류합니다.",
          usableForTodayDecision: true,
        };
      }

      if (
        row.state === "BAND_READY" &&
        row.decisionState === "INVENTORY_SENSITIVE"
      ) {
        return {
          ...common,
          action: "MANUAL_REVIEW",
          actionLabel: "수동 검토",
          basis: "TWO_SIDED_BAND",
          riskBias: "BALANCED_BAND",
          recommendedQuantity: 0,
          reason:
            "추정재고가 낮은 쪽인지 높은 쪽인지에 따라 발주/보류가 뒤집힙니다. 이 상품만 사람이 한 번 확인합니다.",
          usableForTodayDecision: false,
        };
      }

      const purchase = purchaseByBarcode.get(row.barcode);
      const profile = planningByBarcode.get(row.barcode);
      const fallbackInventory = row.cumulativeResidualCandidate;
      const fallbackEligible =
        row.state !== "IDENTITY_BLOCKED" &&
        fallbackInventory !== null &&
        purchase &&
        profile;

      if (fallbackEligible) {
        const fallback = calculateNetRequirement({
          demandTarget: integer(
            purchase.rawRecommendedQty ?? purchase.recommendedQty,
          ),
          originalGroup: salesOrderGroup(purchase.status),
          inventoryKnown: true,
          availableQuantity: fallbackInventory,
          reservedQuantity: 0,
          incomingQuantity: 0,
          ledgerCommitment: integer(purchase.openCommitment),
          moq: Math.max(1, integer(profile.moq) || 1),
          cartonQuantity: Math.max(1, integer(profile.cartonQuantity) || 1),
        });
        const orders = fallback.recommendedQuantity > 0;
        return {
          ...common,
          action: orders ? "FALLBACK_ORDER_REVIEW" : "FALLBACK_HOLD",
          actionLabel: orders ? "보수적 발주 검토" : "보수적 발주 보류",
          basis: "CUMULATIVE_UPPER_BIASED",
          riskBias: "UNDER_ORDER_BIASED",
          recommendedQuantity: fallback.recommendedQuantity,
          planningInventoryQuantity: fallbackInventory,
          reason: orders
            ? "완전한 최신 입고증거를 기다리지 않고 과거 누적발주에서 최근 360일 exact 판매를 뺀 상한편향 추정재고를 임시 사용했습니다. 실제재고를 높게 잡을 수 있으므로 과잉발주보다 발주가 늦어질 위험을 받아들이는 절충안입니다."
            : "상한편향 추정재고를 적용하면 현재 수요목표와 미입고 수량을 감안해 추가 발주가 필요하지 않습니다. 실제보다 재고를 높게 잡았을 가능성이 있으므로 품절 발생 시 0-reset으로 빠르게 교정합니다.",
          usableForTodayDecision: true,
        };
      }

      return {
        ...common,
        action: "DATA_HOLD",
        actionLabel: "데이터 보류",
        basis: "INSUFFICIENT",
        riskBias: "UNKNOWN",
        recommendedQuantity: 0,
        reason:
          "현재 증거로는 추정재고 밴드도 상한편향 대체값도 만들 수 없습니다. 이 상품만 빠른 운영 범위에서 제외합니다.",
        usableForTodayDecision: false,
      };
    })
    .sort(
      (left, right) =>
        actionPriority(left.action) - actionPriority(right.action) ||
        right.recommendedQuantity - left.recommendedQuantity ||
        left.barcode.localeCompare(right.barcode),
    );

  const stable = rows.map((row) => ({
    barcode: row.barcode,
    action: row.action,
    basis: row.basis,
    recommendedQuantity: row.recommendedQuantity,
    planningInventoryQuantity: row.planningInventoryQuantity,
    inventoryBandLow: row.inventoryBandLow,
    inventoryBandHigh: row.inventoryBandHigh,
    lowScenarioRecommendedQuantity: row.lowScenarioRecommendedQuantity,
    highScenarioRecommendedQuantity: row.highScenarioRecommendedQuantity,
  }));
  const ready =
    diagnostics.state === "READY_READ_ONLY" &&
    Boolean(purchaseShadow.snapshot) &&
    planning.products.length > 0;

  return {
    generatedAt: new Date().toISOString(),
    state: ready ? "READY_MVP" : "BLOCKED",
    message: ready
      ? "빠른 사용 우선 모드입니다. 양쪽 재고 시나리오가 완성된 상품은 기존 보수 규칙을 쓰고, 최신 입고증거만 부족하지만 누적 발주이력과 exact 판매가 있는 상품은 실제재고보다 높게 잡힐 수 있는 상한편향 추정재고를 임시 사용합니다. 따라서 과잉발주보다 발주 지연 쪽 위험을 허용합니다. 실제 중국 주문은 수동입니다."
      : "발주 수요 또는 PROVISIONAL 추정재고 입력이 준비되지 않아 빠른 운영 발주안을 만들지 않습니다.",
    evaluatedCount: rows.length,
    orderReviewCount: rows.filter(
      (row) =>
        row.action === "ORDER_REVIEW" ||
        row.action === "FALLBACK_ORDER_REVIEW",
    ).length,
    holdCount: rows.filter(
      (row) => row.action === "HOLD" || row.action === "FALLBACK_HOLD",
    ).length,
    fallbackDecisionCount: rows.filter(
      (row) => row.basis === "CUMULATIVE_UPPER_BIASED",
    ).length,
    manualReviewCount: rows.filter(
      (row) => row.action === "MANUAL_REVIEW",
    ).length,
    dataHoldCount: rows.filter((row) => row.action === "DATA_HOLD").length,
    usableDecisionCount: rows.filter((row) => row.usableForTodayDecision).length,
    fingerprint: sha256({
      diagnosticsFingerprint: diagnostics.fingerprint,
      purchaseFingerprint: purchaseShadow.canonicalContentFingerprint,
      planningFingerprint: planning.contentFingerprint,
      rows: stable,
    }),
    mode: "FAST_USE_PROVISIONAL_V2",
    manualOrderOnly: true,
    automaticPurchaseEnabled: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
    rows,
  };
}
