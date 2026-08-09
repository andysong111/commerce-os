import { loadProvisionalInventoryBandValidation } from "@/lib/stage8ProvisionalInventoryBandValidation";
import {
  buildProvisionalDecisionEnvelope,
  type ProvisionalDecisionEnvelope,
  type ProvisionalDecisionEnvelopeInput,
  type ProvisionalDecisionEnvelopeState,
} from "@/lib/stage8ProvisionalDecisionEnvelopeEngine";

export {
  buildProvisionalDecisionEnvelope,
  type ProvisionalDecisionEnvelope,
  type ProvisionalDecisionEnvelopeInput,
  type ProvisionalDecisionEnvelopeState,
};

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
