import { createHash } from "node:crypto";
import { loadProvisionalDecisionEvidenceGate } from "@/lib/stage8ProvisionalDecisionEvidenceGate";

export type FastPurchaseMvpAction =
  | "ORDER_REVIEW"
  | "HOLD"
  | "MANUAL_REVIEW"
  | "DATA_HOLD";

export type FastPurchaseMvpRow = {
  barcode: string;
  modelNo: string | null;
  productName: string;
  action: FastPurchaseMvpAction;
  actionLabel: string;
  recommendedQuantity: number;
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
  manualReviewCount: number;
  dataHoldCount: number;
  usableDecisionCount: number;
  fingerprint: string;
  mode: "FAST_USE_PROVISIONAL_V1";
  manualOrderOnly: true;
  automaticPurchaseEnabled: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
  rows: FastPurchaseMvpRow[];
};

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function actionPriority(action: FastPurchaseMvpAction) {
  if (action === "ORDER_REVIEW") return 0;
  if (action === "MANUAL_REVIEW") return 1;
  if (action === "HOLD") return 2;
  return 3;
}

export async function loadFastPurchaseMvp(): Promise<FastPurchaseMvpReport> {
  const gate = await loadProvisionalDecisionEvidenceGate();

  const rows = gate.rows
    .map((row): FastPurchaseMvpRow => {
      if (
        row.state === "DRAFT_EVIDENCE_READY" &&
        row.conservativeDraftRecommendedQuantity > 0
      ) {
        return {
          barcode: row.barcode,
          modelNo: row.modelNo,
          productName: row.productName,
          action: "ORDER_REVIEW",
          actionLabel: "발주 검토",
          recommendedQuantity: row.conservativeDraftRecommendedQuantity,
          inventoryBandLow: row.diagnosticLowQuantity,
          inventoryBandHigh: row.diagnosticHighQuantity,
          lowScenarioRecommendedQuantity: row.lowRecommendedQuantity,
          highScenarioRecommendedQuantity: row.highRecommendedQuantity,
          reason:
            "추정재고 밴드의 낮은값과 높은값 양쪽 모두 발주가 필요합니다. 과잉발주를 줄이기 위해 두 시나리오 권장수량 중 더 작은 수량을 오늘의 보수적 발주 검토수량으로 사용합니다.",
          usableForTodayDecision: true,
          manualOrderOnly: true,
          automaticPurchaseEnabled: false,
          purchaseWritesEnabled: false,
          inventoryWritesEnabled: false,
        };
      }

      if (row.state === "HOLD_EVIDENCE_READY") {
        return {
          barcode: row.barcode,
          modelNo: row.modelNo,
          productName: row.productName,
          action: "HOLD",
          actionLabel: "발주 보류",
          recommendedQuantity: 0,
          inventoryBandLow: row.diagnosticLowQuantity,
          inventoryBandHigh: row.diagnosticHighQuantity,
          lowScenarioRecommendedQuantity: row.lowRecommendedQuantity,
          highScenarioRecommendedQuantity: row.highRecommendedQuantity,
          reason:
            "추정재고 밴드의 낮은값과 높은값 양쪽 모두에서 신규 발주가 필요하지 않습니다. 현재는 보류가 더 안전합니다.",
          usableForTodayDecision: true,
          manualOrderOnly: true,
          automaticPurchaseEnabled: false,
          purchaseWritesEnabled: false,
          inventoryWritesEnabled: false,
        };
      }

      if (row.state === "INVENTORY_SENSITIVE") {
        return {
          barcode: row.barcode,
          modelNo: row.modelNo,
          productName: row.productName,
          action: "MANUAL_REVIEW",
          actionLabel: "수동 검토",
          recommendedQuantity: 0,
          inventoryBandLow: row.diagnosticLowQuantity,
          inventoryBandHigh: row.diagnosticHighQuantity,
          lowScenarioRecommendedQuantity: row.lowRecommendedQuantity,
          highScenarioRecommendedQuantity: row.highRecommendedQuantity,
          reason:
            "추정재고가 낮은 쪽인지 높은 쪽인지에 따라 발주/보류가 뒤집힙니다. 이런 상품은 빠른 운영 모드에서도 자동 수량을 제시하지 않고 사람이 한 번만 확인합니다.",
          usableForTodayDecision: false,
          manualOrderOnly: true,
          automaticPurchaseEnabled: false,
          purchaseWritesEnabled: false,
          inventoryWritesEnabled: false,
        };
      }

      return {
        barcode: row.barcode,
        modelNo: row.modelNo,
        productName: row.productName,
        action: "DATA_HOLD",
        actionLabel: "데이터 보류",
        recommendedQuantity: 0,
        inventoryBandLow: row.diagnosticLowQuantity,
        inventoryBandHigh: row.diagnosticHighQuantity,
        lowScenarioRecommendedQuantity: row.lowRecommendedQuantity,
        highScenarioRecommendedQuantity: row.highRecommendedQuantity,
        reason:
          "현재 증거만으로는 추정재고 밴드 또는 발주방향을 만들기 부족합니다. 빠른 운영 범위에서 제외하고 기존 판매를 계속 관찰합니다.",
        usableForTodayDecision: false,
        manualOrderOnly: true,
        automaticPurchaseEnabled: false,
        purchaseWritesEnabled: false,
        inventoryWritesEnabled: false,
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
    recommendedQuantity: row.recommendedQuantity,
    inventoryBandLow: row.inventoryBandLow,
    inventoryBandHigh: row.inventoryBandHigh,
    lowScenarioRecommendedQuantity: row.lowScenarioRecommendedQuantity,
    highScenarioRecommendedQuantity: row.highScenarioRecommendedQuantity,
  }));
  const ready = gate.state === "READY_READ_ONLY";

  return {
    generatedAt: new Date().toISOString(),
    state: ready ? "READY_MVP" : "BLOCKED",
    message: ready
      ? "완벽한 재고확정을 기다리지 않고 현재 증거로 방향이 안정적인 상품만 바로 운영에 사용합니다. 발주 필요가 양쪽 시나리오에서 모두 유지되면 더 작은 권장수량을 사용하고, 방향이 뒤집히는 상품은 보류합니다. 실제 중국 주문 자동전송은 아직 하지 않습니다."
      : "추정재고 발주방향 게이트가 준비되지 않아 빠른 운영 발주안을 만들지 않습니다.",
    evaluatedCount: rows.length,
    orderReviewCount: rows.filter((row) => row.action === "ORDER_REVIEW").length,
    holdCount: rows.filter((row) => row.action === "HOLD").length,
    manualReviewCount: rows.filter((row) => row.action === "MANUAL_REVIEW").length,
    dataHoldCount: rows.filter((row) => row.action === "DATA_HOLD").length,
    usableDecisionCount: rows.filter((row) => row.usableForTodayDecision).length,
    fingerprint: sha256({ gateFingerprint: gate.fingerprint, rows: stable }),
    mode: "FAST_USE_PROVISIONAL_V1",
    manualOrderOnly: true,
    automaticPurchaseEnabled: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
    rows,
  };
}
