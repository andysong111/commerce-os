import {
  loadProductMasterShoplingSalesStatus,
  type ProductMasterShoplingSalesStatus,
} from "@/lib/productMasterShoplingSalesBackfill";
import {
  loadProductMasterShoplingSalesIncrementalStatus,
  type ProductMasterShoplingSalesIncrementalStatus,
} from "@/lib/productMasterShoplingSalesIncremental";
import {
  loadProductMasterInventoryCostReadiness,
  type ProductMasterInventoryCostReadiness,
} from "@/lib/productMasterInventoryCostReadiness";
import {
  comparePriceGradeInputs,
  loadPriceGradeInputSnapshot,
  type PriceGradeShadowResult,
} from "@/lib/priceGradeShadowComparison";
import {
  loadProductDecisionLiveStatus,
  loadProductPlanningSnapshot,
  type ProductDecisionLiveStatus,
} from "@/lib/productDecisionLiveRefresh";

export type Stage8CheckState = "READY" | "PROVISIONAL" | "BLOCKED" | "ERROR";

export type Stage8Check = {
  key: string;
  label: string;
  state: Stage8CheckState;
  message: string;
};

export type Stage8ReadinessReport = {
  generatedAt: string;
  salesBaseline: ProductMasterShoplingSalesStatus;
  salesIncremental: ProductMasterShoplingSalesIncrementalStatus;
  inventoryCost: ProductMasterInventoryCostReadiness;
  planning: {
    generatedAt: string;
    contentFingerprint: string;
    productCount: number;
  };
  priceGradePreview: PriceGradeShadowResult;
  purchaseLegacyShadow: ProductDecisionLiveStatus;
  checks: Stage8Check[];
  summary: {
    canonicalFoundationReady: boolean;
    priceGradeShadowAllowed: boolean;
    priceGradeFullPromotionReady: boolean;
    priceGradeActionableInputCount: number;
    purchaseShadowAllowed: boolean;
    purchaseLegacyShadowCompleted: boolean;
    inventoryVerifiedCount: number;
    inventoryUnverifiedCount: number;
    receiptCostCoveredCount: number;
    receiptCostMissingCount: number;
    businessWritesEnabled: false;
  };
  nextDevelopment: string[];
};

function check(
  key: string,
  label: string,
  state: Stage8CheckState,
  message: string,
): Stage8Check {
  return { key, label, state, message };
}

export async function loadStage8Readiness(): Promise<Stage8ReadinessReport> {
  const [salesBaseline, salesIncremental, inventoryCost, planning, priceInput, purchaseLegacyShadow] =
    await Promise.all([
      loadProductMasterShoplingSalesStatus(),
      loadProductMasterShoplingSalesIncrementalStatus(),
      loadProductMasterInventoryCostReadiness(),
      loadProductPlanningSnapshot(),
      loadPriceGradeInputSnapshot(),
      loadProductDecisionLiveStatus(),
    ]);

  // Pure calculation only. This preview is intentionally not stored so merely
  // opening the readiness page cannot create an operation or business write.
  const priceGradePreview = comparePriceGradeInputs(
    priceInput,
    "stage8-readiness-preview",
  );

  const salesBaselineReady = salesBaseline.state === "COMPLETED";
  const incrementalHealthy =
    salesIncremental.baselineState === "COMPLETED" &&
    !["FAILED", "WAITING_BASELINE"].includes(salesIncremental.state);
  const planningReady =
    /^sha256:[a-f0-9]{64}$/.test(planning.contentFingerprint) &&
    planning.products.length > 0;
  const canonicalFoundationReady =
    salesBaselineReady && incrementalHealthy && planningReady;

  const priceGradeActionableInputCount = Math.max(
    0,
    priceGradePreview.summary.evaluatedCount - priceGradePreview.summary.blockedCount,
  );
  const priceGradeShadowAllowed = canonicalFoundationReady;
  const priceGradeFullPromotionReady =
    priceGradeShadowAllowed &&
    priceGradePreview.summary.blockedCount === 0 &&
    priceGradePreview.summary.unexplainedCount === 0;

  const purchaseShadowAllowed = canonicalFoundationReady;
  const purchaseLegacyShadowCompleted =
    purchaseLegacyShadow.state === "COMPLETED" &&
    Boolean(purchaseLegacyShadow.finalSnapshot);

  const summary = inventoryCost.summary;
  const checks: Stage8Check[] = [
    check(
      "sales-baseline",
      "판매 기준원장",
      salesBaselineReady ? "READY" : "BLOCKED",
      salesBaselineReady
        ? `최초 판매원장 ${salesBaseline.monthlyRowCount}건이 완료 상태입니다.`
        : `최초 판매원장 상태가 ${salesBaseline.state}입니다.`,
    ),
    check(
      "sales-incremental",
      "판매 증분동기화",
      incrementalHealthy ? "READY" : "BLOCKED",
      incrementalHealthy
        ? `기준선 ${salesIncremental.baselineState} · 증분 ${salesIncremental.state} · 미연결 ${salesIncremental.unmappedRows}건입니다.`
        : salesIncremental.message,
    ),
    check(
      "inventory",
      "현재재고 신뢰도",
      summary.inventoryVerifiedCount > 0 ? "PROVISIONAL" : "PROVISIONAL",
      `확인재고 ${summary.inventoryVerifiedCount}/${summary.managedActiveSkuCount} · 초기 0·미확인 ${summary.initialZeroUnverifiedCount}개입니다. 미확인 재고는 그림자 계산을 막지 않지만 실제 재고 차감 근거로 사용하지 않습니다.`,
    ),
    check(
      "receipt-cost",
      "확정 입고원가",
      summary.missingConfirmedReceiptCostSkuCount === 0 ? "READY" : "PROVISIONAL",
      `확정원가 ${summary.confirmedReceiptCostSkuCount}/${summary.managedActiveSkuCount} · 미보유 ${summary.missingConfirmedReceiptCostSkuCount}개입니다. 원가 없는 SKU의 가격·마진 조치는 개별 차단합니다.`,
    ),
    check(
      "price-grade-shadow",
      "상품등급·가격 그림자",
      !priceGradeShadowAllowed
        ? "BLOCKED"
        : priceGradeFullPromotionReady
          ? "READY"
          : "PROVISIONAL",
      `현재 입력 ${priceGradePreview.summary.inputCount}개 · 엔진차단 ${priceGradePreview.summary.blockedCount}개 · 원인불명 차이 ${priceGradePreview.summary.unexplainedCount}개입니다.`,
    ),
    check(
      "purchase-shadow",
      "발주 추천 그림자",
      !purchaseShadowAllowed
        ? "BLOCKED"
        : purchaseLegacyShadowCompleted
          ? "PROVISIONAL"
          : "PROVISIONAL",
      purchaseLegacyShadowCompleted
        ? "기존 실시간 Shopling 기반 자체 발주 그림자는 완료되어 있습니다. 다음 전환은 판매수요를 Product Master canonical 판매원장으로 직접 읽는 구조입니다."
        : `기존 실시간 발주 그림자 상태가 ${purchaseLegacyShadow.state}입니다. canonical 판매원장 기반 새 그림자는 별도 전환합니다.`,
    ),
  ];

  return {
    generatedAt: new Date().toISOString(),
    salesBaseline,
    salesIncremental,
    inventoryCost,
    planning: {
      generatedAt: planning.generatedAt,
      contentFingerprint: planning.contentFingerprint,
      productCount: planning.products.length,
    },
    priceGradePreview,
    purchaseLegacyShadow,
    checks,
    summary: {
      canonicalFoundationReady,
      priceGradeShadowAllowed,
      priceGradeFullPromotionReady,
      priceGradeActionableInputCount,
      purchaseShadowAllowed,
      purchaseLegacyShadowCompleted,
      inventoryVerifiedCount: summary.inventoryVerifiedCount,
      inventoryUnverifiedCount: summary.initialZeroUnverifiedCount,
      receiptCostCoveredCount: summary.confirmedReceiptCostSkuCount,
      receiptCostMissingCount: summary.missingConfirmedReceiptCostSkuCount,
      businessWritesEnabled: false,
    },
    nextDevelopment: [
      "발주 추천의 판매수요 입력을 Product Master canonical 판매원장으로 전환하고, Shopling 직접조회는 클레임처럼 Product Master에 없는 보조 신호로만 제한합니다.",
      "상품등급·가격 그림자는 확정원가가 있는 SKU만 조치 가능 후보로 두고, 원가 미보유 SKU는 관측·차단 상태로 유지합니다.",
      "현재재고 미확인 SKU는 발주 그림자 계산은 허용하되 확인재고 차감값을 0으로 취급하고 최종 자동발주·가격인하·단종 실행은 계속 차단합니다.",
      "중국 입고확정의 Product Master 전송은 기존 outbox 멱등 재시도 경로를 유지해 앞으로 확정원가 커버리지가 운영 중 자연스럽게 증가하도록 합니다.",
    ],
  };
}
