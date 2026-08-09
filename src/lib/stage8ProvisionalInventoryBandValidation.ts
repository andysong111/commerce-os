import { createHash } from "node:crypto";
import { provisionalInventoryValidationEvidenceByBarcode } from "@/data/stage8ProvisionalInventoryValidationEvidence";
import { calculateNetRequirement } from "@/lib/productDecisionEngine/netRequirement";
import type { SalesOrderGroup } from "@/lib/productDecisionEngine/salesOrder";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadCanonicalPurchaseShadow } from "@/lib/stage8CanonicalPurchaseShadow";
import { loadLegacyOrderSurrogateValidation } from "@/lib/stage8LegacyOrderSurrogateValidation";
import { loadLatestOrderProvisionalValidation } from "@/lib/stage8LatestOrderProvisionalValidation";

const TARGET_BARCODE = "BGG1-1";
const OPERATING_LEAD_DAYS = 14;

export type ProvisionalBandDecisionStability =
  | "ORDER_DIRECTION_STABLE"
  | "HOLD_DIRECTION_STABLE"
  | "INVENTORY_SENSITIVE"
  | "BLOCKED";

export type ProvisionalInventoryBandValidation = {
  generatedAt: string;
  state: "READY_VALIDATION_ONLY" | "BLOCKED";
  message: string;
  barcode: string;
  productName: string;
  modelNumber: string;
  operatingLeadDays: number;
  latestOrderResidualCandidate: number;
  cumulativeOrderResidualCandidate: number;
  diagnosticLowQuantity: number;
  diagnosticHighQuantity: number;
  physicalQuantity: number;
  physicalObservedOn: string;
  physicalInsideDiagnosticBand: boolean;
  lowGapToPhysical: number;
  highGapToPhysical: number;
  rawDemandTarget: number;
  openCommitment: number;
  originalPurchaseStatus: string;
  lowInventoryRecommendedQty: number;
  lowInventoryPurchaseStatus: string;
  highInventoryRecommendedQty: number;
  highInventoryPurchaseStatus: string;
  physicalInventoryRecommendedQty: number;
  physicalInventoryPurchaseStatus: string;
  decisionStability: ProvisionalBandDecisionStability;
  fingerprint: string;
  bandIsProvenInventoryBounds: false;
  inventoryUseAllowed: false;
  operationalEstimatePromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeBarcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function group(value: unknown): SalesOrderGroup {
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

export async function loadProvisionalInventoryBandValidation(): Promise<ProvisionalInventoryBandValidation> {
  const [latest, cumulative, purchaseShadow, planning] = await Promise.all([
    loadLatestOrderProvisionalValidation(),
    loadLegacyOrderSurrogateValidation(),
    loadCanonicalPurchaseShadow(),
    loadProductPlanningSnapshot(),
  ]);
  const physical = provisionalInventoryValidationEvidenceByBarcode().get(TARGET_BARCODE) ?? null;
  const latestScenario = latest.scenarios.find(
    (row) => row.leadDays === OPERATING_LEAD_DAYS,
  ) ?? null;
  const cumulativeRow = cumulative.rows.find(
    (row) => normalizeBarcode(row.barcode) === TARGET_BARCODE,
  ) ?? null;
  const purchase = purchaseShadow.snapshot?.products.find(
    (row) => normalizeBarcode(row.barcode) === TARGET_BARCODE,
  ) ?? null;
  const profile = planning.products.find(
    (row) => normalizeBarcode(row.barcode) === TARGET_BARCODE && row.skuActive !== false,
  ) ?? null;

  if (
    latest.state !== "READY_VALIDATION_ONLY" ||
    !latestScenario ||
    !cumulativeRow ||
    !purchaseShadow.shadowReady ||
    !purchase ||
    !profile ||
    !physical
  ) {
    return {
      generatedAt: new Date().toISOString(),
      state: "BLOCKED",
      message: "최신발주 잔여후보·누적발주 잔여후보·Canonical 발주 shadow·실물 검증표본이 모두 준비되어야 불확실성 밴드를 계산합니다.",
      barcode: TARGET_BARCODE,
      productName: latest.productName,
      modelNumber: latest.modelNumber,
      operatingLeadDays: OPERATING_LEAD_DAYS,
      latestOrderResidualCandidate: latestScenario?.diagnosticResidualQuantity ?? 0,
      cumulativeOrderResidualCandidate: cumulativeRow?.diagnosticOrderMinusCanonicalSales ?? 0,
      diagnosticLowQuantity: 0,
      diagnosticHighQuantity: 0,
      physicalQuantity: physical?.physicalQuantity ?? 0,
      physicalObservedOn: physical?.observedOn ?? "",
      physicalInsideDiagnosticBand: false,
      lowGapToPhysical: 0,
      highGapToPhysical: 0,
      rawDemandTarget: 0,
      openCommitment: 0,
      originalPurchaseStatus: purchase ? text(purchase.status) : "",
      lowInventoryRecommendedQty: 0,
      lowInventoryPurchaseStatus: "",
      highInventoryRecommendedQty: 0,
      highInventoryPurchaseStatus: "",
      physicalInventoryRecommendedQty: 0,
      physicalInventoryPurchaseStatus: "",
      decisionStability: "BLOCKED",
      fingerprint: sha256({ state: "BLOCKED", barcode: TARGET_BARCODE }),
      bandIsProvenInventoryBounds: false,
      inventoryUseAllowed: false,
      operationalEstimatePromotionAllowed: false,
      purchaseWritesEnabled: false,
      inventoryWritesEnabled: false,
    };
  }

  const latestResidual = integer(latestScenario.diagnosticResidualQuantity);
  const cumulativeResidual = integer(cumulativeRow.diagnosticOrderMinusCanonicalSales);
  const diagnosticLowQuantity = Math.min(latestResidual, cumulativeResidual);
  const diagnosticHighQuantity = Math.max(latestResidual, cumulativeResidual);
  const physicalQuantity = integer(physical.physicalQuantity);
  const rawDemandTarget = integer(purchase.rawRecommendedQty ?? purchase.recommendedQty);
  const originalGroup = group(purchase.status);
  const openCommitment = integer(purchase.openCommitment);
  const moq = Math.max(1, integer(profile.moq) || 1);
  const cartonQuantity = Math.max(1, integer(profile.cartonQuantity) || 1);

  const calculate = (inventoryQuantity: number) =>
    calculateNetRequirement({
      demandTarget: rawDemandTarget,
      originalGroup,
      inventoryKnown: true,
      availableQuantity: inventoryQuantity,
      reservedQuantity: 0,
      incomingQuantity: 0,
      ledgerCommitment: openCommitment,
      moq,
      cartonQuantity,
    });
  const low = calculate(diagnosticLowQuantity);
  const high = calculate(diagnosticHighQuantity);
  const actual = calculate(physicalQuantity);
  const lowOrder = low.recommendedQuantity > 0;
  const highOrder = high.recommendedQuantity > 0;
  const decisionStability: ProvisionalBandDecisionStability =
    lowOrder && highOrder
      ? "ORDER_DIRECTION_STABLE"
      : !lowOrder && !highOrder
        ? "HOLD_DIRECTION_STABLE"
        : "INVENTORY_SENSITIVE";

  const stable = {
    barcode: TARGET_BARCODE,
    operatingLeadDays: OPERATING_LEAD_DAYS,
    latestResidual,
    cumulativeResidual,
    diagnosticLowQuantity,
    diagnosticHighQuantity,
    physicalQuantity,
    rawDemandTarget,
    originalGroup,
    openCommitment,
    moq,
    cartonQuantity,
    low,
    high,
    actual,
    decisionStability,
    purchaseFingerprint: purchaseShadow.canonicalContentFingerprint,
    planningFingerprint: planning.contentFingerprint,
  };

  return {
    generatedAt: new Date().toISOString(),
    state: "READY_VALIDATION_ONLY",
    message: "정확한 한 점 재고를 억지로 만들지 않고, 최신 과거발주 잔여후보와 누적발주 잔여후보 사이를 진단용 불확실성 밴드로 둡니다. 실물 3,000개가 밴드 안에 드는지와 밴드 양끝에서 발주 방향이 같은지 검증합니다. 이 밴드는 아직 증명된 재고 상·하한이 아니므로 운영 발주에는 쓰지 않습니다.",
    barcode: TARGET_BARCODE,
    productName: latest.productName,
    modelNumber: latest.modelNumber,
    operatingLeadDays: OPERATING_LEAD_DAYS,
    latestOrderResidualCandidate: latestResidual,
    cumulativeOrderResidualCandidate: cumulativeResidual,
    diagnosticLowQuantity,
    diagnosticHighQuantity,
    physicalQuantity,
    physicalObservedOn: physical.observedOn,
    physicalInsideDiagnosticBand:
      physicalQuantity >= diagnosticLowQuantity &&
      physicalQuantity <= diagnosticHighQuantity,
    lowGapToPhysical: diagnosticLowQuantity - physicalQuantity,
    highGapToPhysical: diagnosticHighQuantity - physicalQuantity,
    rawDemandTarget,
    openCommitment,
    originalPurchaseStatus: originalGroup,
    lowInventoryRecommendedQty: low.recommendedQuantity,
    lowInventoryPurchaseStatus: low.group,
    highInventoryRecommendedQty: high.recommendedQuantity,
    highInventoryPurchaseStatus: high.group,
    physicalInventoryRecommendedQty: actual.recommendedQuantity,
    physicalInventoryPurchaseStatus: actual.group,
    decisionStability,
    fingerprint: sha256(stable),
    bandIsProvenInventoryBounds: false,
    inventoryUseAllowed: false,
    operationalEstimatePromotionAllowed: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
  };
}
