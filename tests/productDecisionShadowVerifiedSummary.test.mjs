import assert from "node:assert/strict";
import test from "node:test";
import {
  VERIFIED_PRODUCT_DECISION_SHADOW,
  validateVerifiedProductDecisionShadow,
} from "../src/lib/productDecisionEngine/verifiedShadow.ts";

test("verified production shadow separates direct source drift from portfolio-wide calculation effects", () => {
  assert.equal(VERIFIED_PRODUCT_DECISION_SHADOW.sourceInputDriftCount, 8);
  assert.equal(VERIFIED_PRODUCT_DECISION_SHADOW.salesCalculationMismatchCount, 10);
  assert.ok(
    VERIFIED_PRODUCT_DECISION_SHADOW.salesCalculationMismatchCount >
      VERIFIED_PRODUCT_DECISION_SHADOW.sourceInputDriftCount,
  );
});

test("the corrected verified summary accepts eight direct source drifts and rejects the old value ten", () => {
  const products = Array.from(
    { length: VERIFIED_PRODUCT_DECISION_SHADOW.productCount },
    (_, index) => ({
      barcode: `BTEST-${index}`,
      sourceInputDrift: index < 8,
      salesCalculationMatch: index >= 10,
      expectedGroup: "발주 보류",
      replayGroup: "발주 보류",
      expectedQuantity: 0,
      replayQuantity: 0,
      expectedCost: 0,
      replayCost: 0,
      finalMatch: true,
      mismatchReason: null,
    }),
  );

  assert.doesNotThrow(() =>
    validateVerifiedProductDecisionShadow({
      ...VERIFIED_PRODUCT_DECISION_SHADOW,
      products,
    }),
  );
  assert.throws(
    () =>
      validateVerifiedProductDecisionShadow({
        ...VERIFIED_PRODUCT_DECISION_SHADOW,
        sourceInputDriftCount: 10,
        products,
      }),
    /sourceInputDriftCount: 10 ≠ 8/,
  );
});
