import { createHash } from "node:crypto";
import { loadProvisionalInventoryBandValidation } from "@/lib/stage8ProvisionalInventoryBandValidation";

export type ProvisionalDecisionEnvelopeState =
  | "ORDER_DIRECTION_STABLE"
  | "HOLD_DIRECTION_STABLE"
  | "INVENTORY_SENSITIVE"
  | "BLOCKED";

export type ProvisionalDecisionEnvelopeInput = {
  barcode: string;
  lowInventoryQuantity: number;
  highInventoryQuantity: number;
  lowRecommendedQuantity: number;
  highRecommendedQuantity: number;
  lowPurchaseStatus: string;
  highPurchaseStatus: string;
  sourceFingerprint?: string | null;
};

export type ProvisionalDecisionEnvelope = {
  generatedAt: string;
  barcode: string;
  state: ProvisionalDecisionEnvelopeState;
  message: string;
  lowInventoryQuantity: number;
  highInventoryQuantity: number;
  lowRecommendedQuantity: number;
  highRecommendedQuantity: number;
  conservativeDraftRecommendedQuantity: number;
  draftRecommendationEligible: boolean;
  automaticPurchaseEligible: false;
  inventoryPromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
  fingerprint: string;
};

function safeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function buildProvisionalDecisionEnvelope(
  input: ProvisionalDecisionEnvelopeInput,
): ProvisionalDecisionEnvelope {
  const lowInventory = safeInteger(input.lowInventoryQuantity);
  const highInventory = safeInteger(input.highInventoryQuantity);
  const lowRecommended = safeInteger(input.lowRecommendedQuantity);
  const highRecommended = safeInteger(input.highRecommendedQuantity);
  const barcode = String(input.barcode ?? "").normalize("NFKC").trim().toUpperCase();

  const invalid =
    !barcode ||
    lowInventory === null ||
    highInventory === null ||
    lowRecommended === null ||
    highRecommended === null ||
    lowInventory > highInventory;

  let state: ProvisionalDecisionEnvelopeState = "BLOCKED";
  let conservativeDraftRecommendedQuantity = 0;
  let draftRecommendationEligible = false;
  let message = "추정재고 범위 또는 발주 시뮬레이션이 올바르지 않아 자동 판단을 차단했습니다.";

  if (!invalid) {
    const lowOrders = lowRecommended > 0;
    const highOrders = highRecommended > 0;
    if (lowOrders && highOrders) {
      state = "ORDER_DIRECTION_STABLE";
      conservativeDraftRecommendedQuantity = Math.min(lowRecommended, highRecommended);
      draftRecommendationEligible = conservativeDraftRecommendedQuantity > 0;
      message = "추정재고의 낮은값과 높은값 모두에서 발주가 필요합니다. 과잉발주를 막기 위해 두 권장수량 중 더 작은 수량만 Draft 후보로 사용합니다.";
    } else if (!lowOrders && !highOrders) {
      state = "HOLD_DIRECTION_STABLE";
      message = "추정재고 범위 양끝 모두에서 발주가 필요하지 않아 발주 보류 방향이 안정적입니다.";
    } else {
      state = "INVENTORY_SENSITIVE";
      message = "추정재고가 어느 쪽에 가까운지에 따라 발주 여부가 바뀌므로 자동 발주 Draft를 만들지 않고 HOLD합니다.";
    }
  }

  const stable = {
    barcode,
    lowInventory,
    highInventory,
    lowRecommended,
    highRecommended,
    lowPurchaseStatus: input.lowPurchaseStatus,
    highPurchaseStatus: input.highPurchaseStatus,
    state,
    conservativeDraftRecommendedQuantity,
    draftRecommendationEligible,
    sourceFingerprint: input.sourceFingerprint ?? null,
  };

  return {
    generatedAt: new Date().toISOString(),
    barcode,
    state,
    message,
    lowInventoryQuantity: lowInventory ?? 0,
    highInventoryQuantity: highInventory ?? 0,
    lowRecommendedQuantity: lowRecommended ?? 0,
    highRecommendedQuantity: highRecommended ?? 0,
    conservativeDraftRecommendedQuantity,
    draftRecommendationEligible,
    automaticPurchaseEligible: false,
    inventoryPromotionAllowed: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
    fingerprint: sha256(stable),
  };
}

export async function loadCurrentProvisionalDecisionEnvelope() {
  const band = await loadProvisionalInventoryBandValidation();
  if (band.state !== "READY_VALIDATION_ONLY") {
    return buildProvisionalDecisionEnvelope({
      barcode: band.barcode,
      lowInventoryQuantity: -1,
      highInventoryQuantity: -1,
      lowRecommendedQuantity: -1,
      highRecommendedQuantity: -1,
      lowPurchaseStatus: band.lowInventoryPurchaseStatus,
      highPurchaseStatus: band.highInventoryPurchaseStatus,
      sourceFingerprint: band.fingerprint,
    });
  }
  return buildProvisionalDecisionEnvelope({
    barcode: band.barcode,
    lowInventoryQuantity: band.diagnosticLowQuantity,
    highInventoryQuantity: band.diagnosticHighQuantity,
    lowRecommendedQuantity: band.lowInventoryRecommendedQty,
    highRecommendedQuantity: band.highInventoryRecommendedQty,
    lowPurchaseStatus: band.lowInventoryPurchaseStatus,
    highPurchaseStatus: band.highInventoryPurchaseStatus,
    sourceFingerprint: band.fingerprint,
  });
}
