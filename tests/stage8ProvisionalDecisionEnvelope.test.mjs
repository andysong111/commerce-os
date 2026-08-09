import assert from "node:assert/strict";
import test from "node:test";
import { buildProvisionalDecisionEnvelope } from "../src/lib/stage8ProvisionalDecisionEnvelopeEngine.ts";

const base = {
  barcode: "BGG1-1",
  lowInventoryQuantity: 1039,
  highInventoryQuantity: 6572,
  lowRecommendedQuantity: 245,
  highRecommendedQuantity: 0,
  lowPurchaseStatus: "발주 추천",
  highPurchaseStatus: "발주 보류",
  sourceFingerprint: "sha256:test",
};

test("BGG1-1 validation sample is inventory-sensitive and never becomes a purchase draft", () => {
  const result = buildProvisionalDecisionEnvelope(base);
  assert.equal(result.state, "INVENTORY_SENSITIVE");
  assert.equal(result.conservativeDraftRecommendedQuantity, 0);
  assert.equal(result.draftRecommendationEligible, false);
  assert.equal(result.automaticPurchaseEligible, false);
  assert.equal(result.purchaseWritesEnabled, false);
  assert.equal(result.inventoryWritesEnabled, false);
});

test("stable order direction uses the smaller recommendation as the conservative draft quantity", () => {
  const result = buildProvisionalDecisionEnvelope({
    ...base,
    lowRecommendedQuantity: 500,
    highRecommendedQuantity: 200,
    highPurchaseStatus: "발주 추천",
  });
  assert.equal(result.state, "ORDER_DIRECTION_STABLE");
  assert.equal(result.conservativeDraftRecommendedQuantity, 200);
  assert.equal(result.draftRecommendationEligible, true);
  assert.equal(result.automaticPurchaseEligible, false);
});

test("stable hold direction produces no draft", () => {
  const result = buildProvisionalDecisionEnvelope({
    ...base,
    lowRecommendedQuantity: 0,
    highRecommendedQuantity: 0,
    lowPurchaseStatus: "발주 보류",
    highPurchaseStatus: "발주 보류",
  });
  assert.equal(result.state, "HOLD_DIRECTION_STABLE");
  assert.equal(result.conservativeDraftRecommendedQuantity, 0);
  assert.equal(result.draftRecommendationEligible, false);
});

test("invalid or inverted bands fail closed", () => {
  const result = buildProvisionalDecisionEnvelope({
    ...base,
    lowInventoryQuantity: 7000,
    highInventoryQuantity: 1000,
  });
  assert.equal(result.state, "BLOCKED");
  assert.equal(result.draftRecommendationEligible, false);
  assert.equal(result.purchaseWritesEnabled, false);
});
