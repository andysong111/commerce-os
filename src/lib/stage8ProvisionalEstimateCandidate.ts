import { createHash } from "node:crypto";
import { calculateNetRequirement } from "@/lib/productDecisionEngine/netRequirement";
import type { SalesOrderGroup } from "@/lib/productDecisionEngine/salesOrder";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadCanonicalPurchaseShadow } from "@/lib/stage8CanonicalPurchaseShadow";
import { loadStage8CanonicalSalesEventSnapshot } from "@/lib/stage8CanonicalSalesEventSnapshot";
import { loadFullCoverageHistoricalOrderEvidence } from "@/lib/stage8FullCoverageHistoricalOrderEvidence";

const OPERATING_LEAD_DAYS = 14;

export type ProvisionalEstimateCandidateState =
  | "LATEST_ORDER_RESIDUAL_CANDIDATE_READY"
  | "SALES_COVERAGE_GAP"
  | "PURCHASE_INPUT_MISSING"
  | "ORDER_HISTORY_NOT_READY";

export type ProvisionalEstimateSensitivity =
  | "ORDER_DIRECTION_STABLE"
  | "HOLD_DIRECTION_STABLE"
  | "RECEIPT_ASSUMPTION_SENSITIVE"
  | "NOT_EVALUATED";

export type ProvisionalEstimateCandidateRow = {
  barcode: string;
  productName: string;
  originalModelNos: string[];
  state: ProvisionalEstimateCandidateState;
  message: string;
  latestOrderDate: string | null;
  assumedReceiptDate: string | null;
  latestOrderQuantity: number | null;
  canonicalSalesSinceAssumedReceipt: number | null;
  latestOrderResidualCandidate: number | null;
  noReceiptScenarioInventory: 0;
  fullReceiptScenarioInventory: number | null;
  noReceiptRecommendedQuantity: number | null;
  fullReceiptRecommendedQuantity: number | null;
  noReceiptPurchaseStatus: string | null;
  fullReceiptPurchaseStatus: string | null;
  receiptAssumptionSensitivity: ProvisionalEstimateSensitivity;
  candidateIsCurrentInventory: false;
  candidateIsInventoryBound: false;
  preexistingStockUnknown: true;
  receiptConfirmationMissing: true;
  provisionalEstimatePromotionAllowed: false;
  inventoryUseAllowed: false;
  purchaseDecisionAllowed: false;
  actualDraftCreationEnabled: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
};

export type ProvisionalEstimateCandidateReport = {
  generatedAt: string;
  state: "READY_READ_ONLY" | "BLOCKED";
  message: string;
  operatingLeadDays: number;
  canonicalCoverageStartAt: string | null;
  canonicalCoverageEndAt: string | null;
  orderHistoryReadyCount: number;
  candidateReadyCount: number;
  coverageGapCount: number;
  purchaseInputMissingCount: number;
  orderDirectionStableCount: number;
  holdDirectionStableCount: number;
  receiptAssumptionSensitiveCount: number;
  fingerprint: string;
  provisionalEstimatePromotionAllowed: false;
  inventoryUseAllowed: false;
  purchaseDecisionAllowed: false;
  actualDraftCreationEnabled: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
  rows: ProvisionalEstimateCandidateRow[];
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

function datePlusDays(date: string, days: number) {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export async function loadProvisionalEstimateCandidate(): Promise<ProvisionalEstimateCandidateReport> {
  const [orders, sales, purchaseShadow, planning] = await Promise.all([
    loadFullCoverageHistoricalOrderEvidence(),
    loadStage8CanonicalSalesEventSnapshot(),
    loadCanonicalPurchaseShadow(),
    loadProductPlanningSnapshot(),
  ]);
  const purchaseRows = purchaseShadow.snapshot?.products ?? [];
  const purchaseByBarcode = new Map(
    purchaseRows.map((row) => [barcode(row.barcode), row] as const),
  );
  const planningByBarcode = new Map(
    planning.products
      .filter((row) => row.skuActive !== false)
      .map((row) => [barcode(row.barcode), row] as const),
  );
  const coverageStartMs = sales.coverageStartAt
    ? Date.parse(sales.coverageStartAt)
    : NaN;

  const rows = orders.rows
    .filter((row) => row.state === "ORDER_HISTORY_READY_NOT_INBOUND")
    .map((row): ProvisionalEstimateCandidateRow => {
      const key = barcode(row.barcode);
      const latestOrderDate = row.latestOrderDate;
      const latestOrderQuantity = row.latestOrderQuantity;
      if (!latestOrderDate || latestOrderQuantity === null) {
        return blockedRow({
          barcode: key,
          productName: row.productName,
          originalModelNos: row.originalModelNos,
          state: "ORDER_HISTORY_NOT_READY",
          message: "최근 발주일 또는 최근 발주수량이 없어 잔여후보를 만들지 않습니다.",
        });
      }

      const assumedReceiptDate = datePlusDays(latestOrderDate, OPERATING_LEAD_DAYS);
      const assumedReceiptMs = assumedReceiptDate
        ? Date.parse(`${assumedReceiptDate}T00:00:00.000Z`)
        : NaN;
      if (
        sales.state !== "READY_READ_ONLY" ||
        !Number.isFinite(coverageStartMs) ||
        !Number.isFinite(assumedReceiptMs) ||
        assumedReceiptMs < coverageStartMs
      ) {
        return {
          ...blockedRow({
            barcode: key,
            productName: row.productName,
            originalModelNos: row.originalModelNos,
            state: "SALES_COVERAGE_GAP",
            message: "최근 발주+14일 시점 이후 판매를 exact Canonical 이벤트로 완전히 차감할 수 없어 잔여후보를 차단합니다.",
          }),
          latestOrderDate,
          assumedReceiptDate,
          latestOrderQuantity,
        };
      }

      const purchase = purchaseByBarcode.get(key);
      const profile = planningByBarcode.get(key);
      if (!purchase || !profile) {
        return {
          ...blockedRow({
            barcode: key,
            productName: row.productName,
            originalModelNos: row.originalModelNos,
            state: "PURCHASE_INPUT_MISSING",
            message: "현재 발주 엔진 입력 또는 planning 프로필이 없어 수령가정 민감도 계산을 차단합니다.",
          }),
          latestOrderDate,
          assumedReceiptDate,
          latestOrderQuantity,
        };
      }

      const targetEvents = sales.events.filter(
        (event) =>
          barcode(event.barcode) === key &&
          event.validSale &&
          Date.parse(event.occurredAt) >= assumedReceiptMs,
      );
      const canonicalSalesSinceAssumedReceipt = targetEvents.reduce(
        (sum, event) => sum + integer(event.quantity),
        0,
      );
      const latestOrderResidualCandidate = Math.max(
        0,
        latestOrderQuantity - canonicalSalesSinceAssumedReceipt,
      );
      const demandTarget = integer(
        purchase.rawRecommendedQty ?? purchase.recommendedQty,
      );
      const originalGroup = salesOrderGroup(purchase.status);
      const openCommitment = integer(purchase.openCommitment);
      const calculate = (inventoryQuantity: number) =>
        calculateNetRequirement({
          demandTarget,
          originalGroup,
          inventoryKnown: true,
          availableQuantity: inventoryQuantity,
          reservedQuantity: 0,
          incomingQuantity: 0,
          ledgerCommitment: openCommitment,
          moq: Math.max(1, integer(profile.moq) || 1),
          cartonQuantity: Math.max(1, integer(profile.cartonQuantity) || 1),
        });
      const noReceipt = calculate(0);
      const fullReceipt = calculate(latestOrderResidualCandidate);
      const noReceiptOrders = noReceipt.recommendedQuantity > 0;
      const fullReceiptOrders = fullReceipt.recommendedQuantity > 0;
      const receiptAssumptionSensitivity: ProvisionalEstimateSensitivity =
        noReceiptOrders && fullReceiptOrders
          ? "ORDER_DIRECTION_STABLE"
          : !noReceiptOrders && !fullReceiptOrders
            ? "HOLD_DIRECTION_STABLE"
            : "RECEIPT_ASSUMPTION_SENSITIVE";

      return {
        barcode: key,
        productName: row.productName,
        originalModelNos: row.originalModelNos,
        state: "LATEST_ORDER_RESIDUAL_CANDIDATE_READY",
        message: "최근 과거발주가 14일 뒤 전량 입고되었다고 가정했을 때 그 이후 exact Canonical 판매를 차감한 잔여후보를 계산합니다. 실제 입고 여부와 발주 전 기존재고가 증명되지 않았으므로 이 값은 현재재고·재고상한·재고하한이 아닙니다.",
        latestOrderDate,
        assumedReceiptDate,
        latestOrderQuantity,
        canonicalSalesSinceAssumedReceipt,
        latestOrderResidualCandidate,
        noReceiptScenarioInventory: 0,
        fullReceiptScenarioInventory: latestOrderResidualCandidate,
        noReceiptRecommendedQuantity: noReceipt.recommendedQuantity,
        fullReceiptRecommendedQuantity: fullReceipt.recommendedQuantity,
        noReceiptPurchaseStatus: noReceipt.group,
        fullReceiptPurchaseStatus: fullReceipt.group,
        receiptAssumptionSensitivity,
        candidateIsCurrentInventory: false,
        candidateIsInventoryBound: false,
        preexistingStockUnknown: true,
        receiptConfirmationMissing: true,
        provisionalEstimatePromotionAllowed: false,
        inventoryUseAllowed: false,
        purchaseDecisionAllowed: false,
        actualDraftCreationEnabled: false,
        purchaseWritesEnabled: false,
        inventoryWritesEnabled: false,
      };
    });

  const ready =
    orders.state === "READY_READ_ONLY" &&
    sales.state === "READY_READ_ONLY" &&
    Boolean(purchaseShadow.snapshot) &&
    planning.products.length > 0;
  const stable = rows.map((row) => ({
    barcode: row.barcode,
    state: row.state,
    latestOrderDate: row.latestOrderDate,
    assumedReceiptDate: row.assumedReceiptDate,
    latestOrderQuantity: row.latestOrderQuantity,
    canonicalSalesSinceAssumedReceipt: row.canonicalSalesSinceAssumedReceipt,
    latestOrderResidualCandidate: row.latestOrderResidualCandidate,
    noReceiptRecommendedQuantity: row.noReceiptRecommendedQuantity,
    fullReceiptRecommendedQuantity: row.fullReceiptRecommendedQuantity,
    receiptAssumptionSensitivity: row.receiptAssumptionSensitivity,
  }));

  return {
    generatedAt: new Date().toISOString(),
    state: ready ? "READY_READ_ONLY" : "BLOCKED",
    message: ready
      ? "완전증거 과거발주를 exact Canonical 판매와 결합해 최근발주 잔여후보와 수령가정 민감도만 계산합니다. 이 값은 초기 PROVISIONAL 추정식을 검증하기 위한 후보이며 현재재고나 발주실행 조건으로 승격하지 않습니다."
      : "과거 발주증거·Canonical 판매·발주 입력 중 하나가 준비되지 않아 추정재고 후보를 운영 판단에 사용하지 않습니다.",
    operatingLeadDays: OPERATING_LEAD_DAYS,
    canonicalCoverageStartAt: sales.coverageStartAt,
    canonicalCoverageEndAt: sales.coverageEndAt,
    orderHistoryReadyCount: orders.orderHistoryReadyCount,
    candidateReadyCount: rows.filter(
      (row) => row.state === "LATEST_ORDER_RESIDUAL_CANDIDATE_READY",
    ).length,
    coverageGapCount: rows.filter((row) => row.state === "SALES_COVERAGE_GAP").length,
    purchaseInputMissingCount: rows.filter(
      (row) => row.state === "PURCHASE_INPUT_MISSING",
    ).length,
    orderDirectionStableCount: rows.filter(
      (row) => row.receiptAssumptionSensitivity === "ORDER_DIRECTION_STABLE",
    ).length,
    holdDirectionStableCount: rows.filter(
      (row) => row.receiptAssumptionSensitivity === "HOLD_DIRECTION_STABLE",
    ).length,
    receiptAssumptionSensitiveCount: rows.filter(
      (row) =>
        row.receiptAssumptionSensitivity === "RECEIPT_ASSUMPTION_SENSITIVE",
    ).length,
    fingerprint: sha256({
      orderFingerprint: orders.fingerprint,
      salesFingerprint: sales.fingerprint,
      purchaseFingerprint: purchaseShadow.canonicalContentFingerprint,
      planningFingerprint: planning.contentFingerprint,
      rows: stable,
    }),
    provisionalEstimatePromotionAllowed: false,
    inventoryUseAllowed: false,
    purchaseDecisionAllowed: false,
    actualDraftCreationEnabled: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
    rows,
  };
}

function blockedRow(input: {
  barcode: string;
  productName: string;
  originalModelNos: string[];
  state: Exclude<ProvisionalEstimateCandidateState, "LATEST_ORDER_RESIDUAL_CANDIDATE_READY">;
  message: string;
}): ProvisionalEstimateCandidateRow {
  return {
    barcode: input.barcode,
    productName: input.productName,
    originalModelNos: input.originalModelNos,
    state: input.state,
    message: input.message,
    latestOrderDate: null,
    assumedReceiptDate: null,
    latestOrderQuantity: null,
    canonicalSalesSinceAssumedReceipt: null,
    latestOrderResidualCandidate: null,
    noReceiptScenarioInventory: 0,
    fullReceiptScenarioInventory: null,
    noReceiptRecommendedQuantity: null,
    fullReceiptRecommendedQuantity: null,
    noReceiptPurchaseStatus: null,
    fullReceiptPurchaseStatus: null,
    receiptAssumptionSensitivity: "NOT_EVALUATED",
    candidateIsCurrentInventory: false,
    candidateIsInventoryBound: false,
    preexistingStockUnknown: true,
    receiptConfirmationMissing: true,
    provisionalEstimatePromotionAllowed: false,
    inventoryUseAllowed: false,
    purchaseDecisionAllowed: false,
    actualDraftCreationEnabled: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
  };
}
