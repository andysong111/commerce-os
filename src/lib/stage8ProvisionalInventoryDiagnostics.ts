import { createHash } from "node:crypto";
import { calculateNetRequirement } from "@/lib/productDecisionEngine/netRequirement";
import type { SalesOrderGroup } from "@/lib/productDecisionEngine/salesOrder";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadCanonicalPurchaseShadow } from "@/lib/stage8CanonicalPurchaseShadow";
import { loadStage8CanonicalSalesEventSnapshot } from "@/lib/stage8CanonicalSalesEventSnapshot";
import { loadLegacyOrderHistoryJoinShadow } from "@/lib/stage8LegacyOrderHistoryJoinShadow";
import {
  buildProvisionalDecisionEnvelope,
  type ProvisionalDecisionEnvelopeState,
} from "@/lib/stage8ProvisionalDecisionEnvelope";

const OPERATING_LEAD_DAYS = 14;

export type ProvisionalInventoryDiagnosticState =
  | "BAND_READY"
  | "LATEST_COVERAGE_GAP"
  | "LATEST_ORDER_EVIDENCE_MISSING"
  | "PURCHASE_INPUT_MISSING"
  | "IDENTITY_BLOCKED";

export type ProvisionalInventoryDiagnosticRow = {
  barcode: string;
  modelNo: string | null;
  productName: string;
  state: ProvisionalInventoryDiagnosticState;
  message: string;
  historicalCumulativeOrderQuantity: number | null;
  canonical360SalesQuantity: number;
  cumulativeResidualCandidate: number | null;
  latestOrderDate: string | null;
  latestOrderQuantity: number | null;
  latestDeductionStartDate: string | null;
  canonicalSalesSinceLatestStart: number | null;
  latestResidualCandidate: number | null;
  diagnosticLowQuantity: number | null;
  diagnosticHighQuantity: number | null;
  decisionState: ProvisionalDecisionEnvelopeState | "INSUFFICIENT_BAND_EVIDENCE";
  lowRecommendedQuantity: number | null;
  highRecommendedQuantity: number | null;
  conservativeDraftRecommendedQuantity: number;
  draftSimulationEligible: boolean;
  actualDraftCreationEnabled: false;
  confirmedInbound: false;
  inventoryUseAllowed: false;
  inventoryPromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
};

export type ProvisionalInventoryDiagnostics = {
  generatedAt: string;
  state: "READY_READ_ONLY" | "BLOCKED";
  message: string;
  operatingLeadDays: number;
  canonicalCoverageStartAt: string | null;
  canonicalCoverageEndAt: string | null;
  canonicalEventFingerprint: string | null;
  historyFingerprint: string | null;
  upstreamPurchaseState: string;
  provenIdentityCount: number;
  bandReadyCount: number;
  inventorySensitiveCount: number;
  orderDirectionStableCount: number;
  holdDirectionStableCount: number;
  latestCoverageGapCount: number;
  latestOrderEvidenceMissingCount: number;
  fingerprint: string;
  actualDraftCreationEnabled: false;
  inventoryPromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
  rows: ProvisionalInventoryDiagnosticRow[];
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

export async function loadProvisionalInventoryDiagnostics(): Promise<ProvisionalInventoryDiagnostics> {
  const [history, sales, purchaseShadow, planning] = await Promise.all([
    loadLegacyOrderHistoryJoinShadow(),
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

  const rows: ProvisionalInventoryDiagnosticRow[] = history.rows
    .filter((row) => row.evidence !== null || row.effectiveModelNo !== null)
    .map((row): ProvisionalInventoryDiagnosticRow => {
      const key = barcode(row.barcode);
      const evidence = row.evidence;
      const purchase = purchaseByBarcode.get(key);
      const profile = planningByBarcode.get(key);
      const targetEvents = sales.events.filter(
        (event) => barcode(event.barcode) === key && event.validSale,
      );
      const canonical360SalesQuantity = targetEvents.reduce(
        (sum, event) => sum + integer(event.quantity),
        0,
      );

      if (!row.cumulativeScenarioEligible || !evidence) {
        return blockedRow({
          barcode: key,
          modelNo: row.effectiveModelNo,
          productName: row.productName,
          state: "IDENTITY_BLOCKED",
          message: "정체성 또는 과거 발주이력 증거가 fail-closed 상태여서 추정재고 진단을 만들지 않습니다.",
          canonical360SalesQuantity,
        });
      }

      const cumulativeResidualCandidate = Math.max(
        0,
        evidence.safeCumulativeOrderQuantity - canonical360SalesQuantity,
      );
      const latestDeductionStartDate = datePlusDays(
        evidence.latestSafeOrderDate,
        OPERATING_LEAD_DAYS,
      );
      const latestStartMs = latestDeductionStartDate
        ? Date.parse(`${latestDeductionStartDate}T00:00:00.000Z`)
        : NaN;
      const latestEvidenceReady =
        row.latestOrderScenarioEligible &&
        evidence.latestSafeOrderQuantity !== null &&
        Number.isFinite(latestStartMs);
      const coverageReady =
        latestEvidenceReady &&
        Number.isFinite(coverageStartMs) &&
        latestStartMs >= coverageStartMs;

      if (!purchase || !profile) {
        return {
          ...blockedRow({
            barcode: key,
            modelNo: row.effectiveModelNo,
            productName: row.productName,
            state: "PURCHASE_INPUT_MISSING",
            message: "발주 엔진 입력 또는 planning 프로필이 없어 low/high 발주 민감도 계산을 차단합니다.",
            canonical360SalesQuantity,
          }),
          historicalCumulativeOrderQuantity: evidence.safeCumulativeOrderQuantity,
          cumulativeResidualCandidate,
          latestOrderDate: evidence.latestSafeOrderDate,
          latestOrderQuantity: evidence.latestSafeOrderQuantity,
          latestDeductionStartDate,
        };
      }

      if (!latestEvidenceReady) {
        return {
          ...blockedRow({
            barcode: key,
            modelNo: row.effectiveModelNo,
            productName: row.productName,
            state: "LATEST_ORDER_EVIDENCE_MISSING",
            message: "누적 과거발주 후보는 있으나 최신 1회 주문수량의 exact 증거가 없어 불확실성 밴드를 만들지 않습니다.",
            canonical360SalesQuantity,
          }),
          historicalCumulativeOrderQuantity: evidence.safeCumulativeOrderQuantity,
          cumulativeResidualCandidate,
          latestOrderDate: evidence.latestSafeOrderDate,
          latestOrderQuantity: evidence.latestSafeOrderQuantity,
          latestDeductionStartDate,
        };
      }

      if (!coverageReady) {
        return {
          ...blockedRow({
            barcode: key,
            modelNo: row.effectiveModelNo,
            productName: row.productName,
            state: "LATEST_COVERAGE_GAP",
            message: "최신 과거발주+14일 차감 시작점이 exact Canonical 판매 이벤트 시작보다 앞서 있어 판매 누락 가능성이 있으므로 최신 잔여후보를 차단합니다.",
            canonical360SalesQuantity,
          }),
          historicalCumulativeOrderQuantity: evidence.safeCumulativeOrderQuantity,
          cumulativeResidualCandidate,
          latestOrderDate: evidence.latestSafeOrderDate,
          latestOrderQuantity: evidence.latestSafeOrderQuantity,
          latestDeductionStartDate,
        };
      }

      const canonicalSalesSinceLatestStart = targetEvents
        .filter((event) => Date.parse(event.occurredAt) >= latestStartMs)
        .reduce((sum, event) => sum + integer(event.quantity), 0);
      const latestResidualCandidate = Math.max(
        0,
        (evidence.latestSafeOrderQuantity ?? 0) - canonicalSalesSinceLatestStart,
      );
      const diagnosticLowQuantity = Math.min(
        cumulativeResidualCandidate,
        latestResidualCandidate,
      );
      const diagnosticHighQuantity = Math.max(
        cumulativeResidualCandidate,
        latestResidualCandidate,
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
      const low = calculate(diagnosticLowQuantity);
      const high = calculate(diagnosticHighQuantity);
      const envelope = buildProvisionalDecisionEnvelope({
        barcode: key,
        lowInventoryQuantity: diagnosticLowQuantity,
        highInventoryQuantity: diagnosticHighQuantity,
        lowRecommendedQuantity: low.recommendedQuantity,
        highRecommendedQuantity: high.recommendedQuantity,
        lowPurchaseStatus: low.group,
        highPurchaseStatus: high.group,
        sourceFingerprint: history.fingerprint,
      });

      return {
        barcode: key,
        modelNo: row.effectiveModelNo,
        productName: row.productName,
        state: "BAND_READY",
        message: envelope.message,
        historicalCumulativeOrderQuantity: evidence.safeCumulativeOrderQuantity,
        canonical360SalesQuantity,
        cumulativeResidualCandidate,
        latestOrderDate: evidence.latestSafeOrderDate,
        latestOrderQuantity: evidence.latestSafeOrderQuantity,
        latestDeductionStartDate,
        canonicalSalesSinceLatestStart,
        latestResidualCandidate,
        diagnosticLowQuantity,
        diagnosticHighQuantity,
        decisionState: envelope.state,
        lowRecommendedQuantity: low.recommendedQuantity,
        highRecommendedQuantity: high.recommendedQuantity,
        conservativeDraftRecommendedQuantity:
          envelope.conservativeDraftRecommendedQuantity,
        draftSimulationEligible: envelope.draftRecommendationEligible,
        actualDraftCreationEnabled: false,
        confirmedInbound: false,
        inventoryUseAllowed: false,
        inventoryPromotionAllowed: false,
        purchaseWritesEnabled: false,
        inventoryWritesEnabled: false,
      };
    })
    .sort((left, right) => left.barcode.localeCompare(right.barcode));

  const ready =
    history.state === "READY_READ_ONLY" &&
    sales.state === "READY_READ_ONLY" &&
    Boolean(purchaseShadow.snapshot) &&
    planning.products.length > 0;
  const stable = rows.map((row) => ({
    barcode: row.barcode,
    modelNo: row.modelNo,
    state: row.state,
    cumulativeResidualCandidate: row.cumulativeResidualCandidate,
    latestResidualCandidate: row.latestResidualCandidate,
    diagnosticLowQuantity: row.diagnosticLowQuantity,
    diagnosticHighQuantity: row.diagnosticHighQuantity,
    decisionState: row.decisionState,
    lowRecommendedQuantity: row.lowRecommendedQuantity,
    highRecommendedQuantity: row.highRecommendedQuantity,
  }));

  return {
    generatedAt: new Date().toISOString(),
    state: ready ? "READY_READ_ONLY" : "BLOCKED",
    message: ready
      ? "증명된 과거 발주이력 후보와 exact Canonical 판매를 결합해 SKU별 추정재고 불확실성 밴드와 발주 민감도만 계산합니다. 어느 값도 Product Master 실제재고로 승격하지 않고 실제 발주 Draft도 생성하지 않습니다."
      : "과거 발주 shadow·Canonical 판매 이벤트·발주 입력 중 하나가 준비되지 않아 추정재고 진단을 운영에 사용하지 않습니다.",
    operatingLeadDays: OPERATING_LEAD_DAYS,
    canonicalCoverageStartAt: sales.coverageStartAt,
    canonicalCoverageEndAt: sales.coverageEndAt,
    canonicalEventFingerprint: sales.eventFingerprint,
    historyFingerprint: history.fingerprint,
    upstreamPurchaseState: history.upstreamPurchaseState,
    provenIdentityCount: rows.length,
    bandReadyCount: rows.filter((row) => row.state === "BAND_READY").length,
    inventorySensitiveCount: rows.filter(
      (row) => row.decisionState === "INVENTORY_SENSITIVE",
    ).length,
    orderDirectionStableCount: rows.filter(
      (row) => row.decisionState === "ORDER_DIRECTION_STABLE",
    ).length,
    holdDirectionStableCount: rows.filter(
      (row) => row.decisionState === "HOLD_DIRECTION_STABLE",
    ).length,
    latestCoverageGapCount: rows.filter(
      (row) => row.state === "LATEST_COVERAGE_GAP",
    ).length,
    latestOrderEvidenceMissingCount: rows.filter(
      (row) => row.state === "LATEST_ORDER_EVIDENCE_MISSING",
    ).length,
    fingerprint: sha256({
      salesFingerprint: sales.fingerprint,
      historyFingerprint: history.fingerprint,
      planningFingerprint: planning.contentFingerprint,
      rows: stable,
    }),
    actualDraftCreationEnabled: false,
    inventoryPromotionAllowed: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
    rows,
  };
}

function blockedRow(input: {
  barcode: string;
  modelNo: string | null;
  productName: string;
  state: Exclude<ProvisionalInventoryDiagnosticState, "BAND_READY">;
  message: string;
  canonical360SalesQuantity: number;
}): ProvisionalInventoryDiagnosticRow {
  return {
    barcode: input.barcode,
    modelNo: input.modelNo,
    productName: input.productName,
    state: input.state,
    message: input.message,
    historicalCumulativeOrderQuantity: null,
    canonical360SalesQuantity: input.canonical360SalesQuantity,
    cumulativeResidualCandidate: null,
    latestOrderDate: null,
    latestOrderQuantity: null,
    latestDeductionStartDate: null,
    canonicalSalesSinceLatestStart: null,
    latestResidualCandidate: null,
    diagnosticLowQuantity: null,
    diagnosticHighQuantity: null,
    decisionState: "INSUFFICIENT_BAND_EVIDENCE",
    lowRecommendedQuantity: null,
    highRecommendedQuantity: null,
    conservativeDraftRecommendedQuantity: 0,
    draftSimulationEligible: false,
    actualDraftCreationEnabled: false,
    confirmedInbound: false,
    inventoryUseAllowed: false,
    inventoryPromotionAllowed: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
  };
}
