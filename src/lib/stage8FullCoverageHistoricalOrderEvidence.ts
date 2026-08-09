import { createHash } from "node:crypto";
import {
  fullCoverageHistoricalOrderEvidence,
  type FullCoverageHistoricalOrderEvidence,
} from "@/data/stage8FullCoverageHistoricalOrderEvidence";
import { loadHistoricalGoodsKeyModelCrosswalk } from "@/lib/stage8HistoricalGoodsKeyModelCrosswalk";

export type FullCoverageHistoricalOrderEvidenceState =
  | "ORDER_HISTORY_READY_NOT_INBOUND"
  | "NOT_SINGLE_MODEL_FULL_COVERAGE"
  | "MODEL_CROSSWALK_MISMATCH"
  | "NO_ORDER_EVIDENCE";

export type FullCoverageHistoricalOrderEvidenceRow = {
  barcode: string;
  productName: string;
  crosswalkState: string;
  originalModelNos: string[];
  state: FullCoverageHistoricalOrderEvidenceState;
  message: string;
  sourceArtifact: string | null;
  sourceSheets: string[];
  cumulativeOrderQuantity: number | null;
  recentThreeOrderQuantity: number | null;
  latestOrderDate: string | null;
  latestOrderQuantity: number | null;
  latestOrderOptionCount: number;
  latestOrderWeightedUnitCostKrw: number | null;
  latestOrderMinUnitCostKrw: number | null;
  latestOrderMaxUnitCostKrw: number | null;
  provisionalEstimateInputEligible: boolean;
  confirmedInbound: false;
  currentInventoryUseAllowed: false;
  operationalEstimatePromotionAllowed: false;
  purchaseDecisionAllowed: false;
  inventoryPromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
};

export type FullCoverageHistoricalOrderEvidenceReport = {
  generatedAt: string;
  state: "READY_READ_ONLY" | "BLOCKED";
  message: string;
  purchaseCandidateCount: number;
  singleModelFullCoverageCount: number;
  orderHistoryReadyCount: number;
  noOrderEvidenceCount: number;
  modelCrosswalkMismatchCount: number;
  fingerprint: string;
  confirmedInbound: false;
  currentInventoryUseAllowed: false;
  operationalEstimatePromotionAllowed: false;
  purchaseDecisionAllowed: false;
  inventoryPromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
  rows: FullCoverageHistoricalOrderEvidenceRow[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function modelNo(value: unknown) {
  return text(value).toLowerCase();
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function evidenceByBarcode(rows: FullCoverageHistoricalOrderEvidence[]) {
  return new Map(rows.map((row) => [barcode(row.barcode), row] as const));
}

function latestOrderSummary(evidence: FullCoverageHistoricalOrderEvidence) {
  const latestOrderQuantity = evidence.latestOrderRows.reduce(
    (sum, row) => sum + integer(row.orderQuantity),
    0,
  );
  const weightedCostNumerator = evidence.latestOrderRows.reduce(
    (sum, row) => sum + integer(row.orderQuantity) * Number(row.unitCostKrw || 0),
    0,
  );
  const costs = evidence.latestOrderRows
    .map((row) => Number(row.unitCostKrw))
    .filter((value) => Number.isFinite(value) && value > 0);
  return {
    latestOrderQuantity,
    latestOrderWeightedUnitCostKrw:
      latestOrderQuantity > 0
        ? Math.round((weightedCostNumerator / latestOrderQuantity) * 100) / 100
        : null,
    latestOrderMinUnitCostKrw: costs.length ? Math.min(...costs) : null,
    latestOrderMaxUnitCostKrw: costs.length ? Math.max(...costs) : null,
  };
}

export async function loadFullCoverageHistoricalOrderEvidence(): Promise<FullCoverageHistoricalOrderEvidenceReport> {
  const crosswalk = await loadHistoricalGoodsKeyModelCrosswalk();
  const evidenceRows = fullCoverageHistoricalOrderEvidence();
  const evidenceIndex = evidenceByBarcode(evidenceRows);

  const rows = crosswalk.rows.map((candidate): FullCoverageHistoricalOrderEvidenceRow => {
    const key = barcode(candidate.barcode);
    const evidence = evidenceIndex.get(key) ?? null;
    const singleModelFullCoverage =
      candidate.state === "SINGLE_MODEL_FULL_COVERAGE" &&
      candidate.originalModelNos.length === 1;

    if (!singleModelFullCoverage) {
      return blockedRow({
        barcode: key,
        productName: candidate.productName,
        crosswalkState: candidate.state,
        originalModelNos: candidate.originalModelNos,
        state: "NOT_SINGLE_MODEL_FULL_COVERAGE",
        message: "현재 goods_key 집합 전체가 하나의 원본 aaa 모델로 증명되지 않아 과거 발주수량을 연결하지 않습니다.",
      });
    }

    if (!evidence) {
      return blockedRow({
        barcode: key,
        productName: candidate.productName,
        crosswalkState: candidate.state,
        originalModelNos: candidate.originalModelNos,
        state: "NO_ORDER_EVIDENCE",
        message: "단일모델 완전증거는 있으나 source-pinned 과거 발주수량 증거가 아직 없습니다.",
      });
    }

    const expectedModelNo = modelNo(candidate.originalModelNos[0]);
    if (modelNo(evidence.originalModelNo) !== expectedModelNo) {
      return blockedRow({
        barcode: key,
        productName: candidate.productName,
        crosswalkState: candidate.state,
        originalModelNos: candidate.originalModelNos,
        state: "MODEL_CROSSWALK_MISMATCH",
        message: "goods_key 교차검증 모델번호와 과거 발주이력 모델번호가 달라 연결을 차단합니다.",
      });
    }

    const latest = latestOrderSummary(evidence);
    return {
      barcode: key,
      productName: candidate.productName,
      crosswalkState: candidate.state,
      originalModelNos: candidate.originalModelNos,
      state: "ORDER_HISTORY_READY_NOT_INBOUND",
      message: "goods_key 전체집합과 원본 aaa 모델이 일치하여 과거 발주수량·날짜·원가를 PROVISIONAL 추정재고의 입력증거로 읽을 수 있습니다. 다만 발주기록은 확정입고가 아니므로 이 값 자체를 현재재고나 발주결정으로 승격하지 않습니다.",
      sourceArtifact: evidence.sourceArtifact,
      sourceSheets: evidence.sourceSheets,
      cumulativeOrderQuantity: integer(evidence.cumulativeOrderQuantity),
      recentThreeOrderQuantity: integer(evidence.recentThreeOrderQuantity),
      latestOrderDate: evidence.latestOrderDate,
      latestOrderQuantity: latest.latestOrderQuantity,
      latestOrderOptionCount: evidence.latestOrderRows.length,
      latestOrderWeightedUnitCostKrw: latest.latestOrderWeightedUnitCostKrw,
      latestOrderMinUnitCostKrw: latest.latestOrderMinUnitCostKrw,
      latestOrderMaxUnitCostKrw: latest.latestOrderMaxUnitCostKrw,
      provisionalEstimateInputEligible: true,
      confirmedInbound: false,
      currentInventoryUseAllowed: false,
      operationalEstimatePromotionAllowed: false,
      purchaseDecisionAllowed: false,
      inventoryPromotionAllowed: false,
      purchaseWritesEnabled: false,
      inventoryWritesEnabled: false,
    };
  });

  const ready = crosswalk.state === "READY_READ_ONLY";
  const stable = rows.map((row) => ({
    barcode: row.barcode,
    crosswalkState: row.crosswalkState,
    originalModelNos: row.originalModelNos,
    state: row.state,
    cumulativeOrderQuantity: row.cumulativeOrderQuantity,
    recentThreeOrderQuantity: row.recentThreeOrderQuantity,
    latestOrderDate: row.latestOrderDate,
    latestOrderQuantity: row.latestOrderQuantity,
    latestOrderOptionCount: row.latestOrderOptionCount,
    latestOrderWeightedUnitCostKrw: row.latestOrderWeightedUnitCostKrw,
  }));

  return {
    generatedAt: new Date().toISOString(),
    state: ready ? "READY_READ_ONLY" : "BLOCKED",
    message: ready
      ? "단일 aaa 모델로 전체 goods_key가 증명된 B-code에만 과거 중국 발주이력 수량·날짜·원가를 연결합니다. ORDER_HISTORY는 PROVISIONAL 추정식의 입력증거일 뿐 CONFIRMED_INBOUND 또는 CURRENT_INVENTORY가 아니며, 이 단계에서는 발주판단도 실행하지 않습니다."
      : "과거 goods_key↔aaa 교차검증이 준비되지 않아 발주이력 연결을 차단합니다.",
    purchaseCandidateCount: rows.length,
    singleModelFullCoverageCount: rows.filter(
      (row) => row.crosswalkState === "SINGLE_MODEL_FULL_COVERAGE",
    ).length,
    orderHistoryReadyCount: rows.filter(
      (row) => row.state === "ORDER_HISTORY_READY_NOT_INBOUND",
    ).length,
    noOrderEvidenceCount: rows.filter((row) => row.state === "NO_ORDER_EVIDENCE").length,
    modelCrosswalkMismatchCount: rows.filter(
      (row) => row.state === "MODEL_CROSSWALK_MISMATCH",
    ).length,
    fingerprint: sha256({
      crosswalkFingerprint: crosswalk.fingerprint,
      evidence: evidenceRows,
      rows: stable,
    }),
    confirmedInbound: false,
    currentInventoryUseAllowed: false,
    operationalEstimatePromotionAllowed: false,
    purchaseDecisionAllowed: false,
    inventoryPromotionAllowed: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
    rows,
  };
}

function blockedRow(input: {
  barcode: string;
  productName: string;
  crosswalkState: string;
  originalModelNos: string[];
  state: Exclude<FullCoverageHistoricalOrderEvidenceState, "ORDER_HISTORY_READY_NOT_INBOUND">;
  message: string;
}): FullCoverageHistoricalOrderEvidenceRow {
  return {
    barcode: input.barcode,
    productName: input.productName,
    crosswalkState: input.crosswalkState,
    originalModelNos: input.originalModelNos,
    state: input.state,
    message: input.message,
    sourceArtifact: null,
    sourceSheets: [],
    cumulativeOrderQuantity: null,
    recentThreeOrderQuantity: null,
    latestOrderDate: null,
    latestOrderQuantity: null,
    latestOrderOptionCount: 0,
    latestOrderWeightedUnitCostKrw: null,
    latestOrderMinUnitCostKrw: null,
    latestOrderMaxUnitCostKrw: null,
    provisionalEstimateInputEligible: false,
    confirmedInbound: false,
    currentInventoryUseAllowed: false,
    operationalEstimatePromotionAllowed: false,
    purchaseDecisionAllowed: false,
    inventoryPromotionAllowed: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
  };
}
