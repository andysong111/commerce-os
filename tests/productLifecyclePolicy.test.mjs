import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateProductLifecycle,
  DISCONTINUE_AFTER_DAYS,
} from "../src/lib/productLifecyclePolicy.ts";

const NOW = "2026-08-31T12:00:00.000Z";

function base(overrides = {}) {
  return {
    skuId: "sku-1",
    barcode: "AAA100-1",
    productStatus: "ACTIVE",
    skuActive: true,
    lastSaleAt: "2026-08-20T00:00:00.000Z",
    salesQuantity30: 12,
    salesQuantity90: 30,
    salesQuantity365: 80,
    salesTrend: "STABLE",
    inventoryQuantity: 10,
    inventoryConfirmed: true,
    inventoryRequiresReview: false,
    dataStatus: "NORMAL",
    ...overrides,
  };
}

test("normal active product stays MAINTAIN and selling", () => {
  const decision = evaluateProductLifecycle(base(), NOW);
  assert.equal(decision.lifecycleState, "MAINTAIN");
  assert.equal(decision.desiredShoplingState, "SELLING");
  assert.equal(decision.purchasePolicy, "NORMAL");
  assert.equal(decision.requiresReview, false);
});

test("unverified baseline data status does not flood CEO exceptions for non-destructive active decisions", () => {
  const decision = evaluateProductLifecycle(
    base({
      dataStatus: "REVIEW",
      inventoryConfirmed: false,
      inventoryRequiresReview: false,
    }),
    NOW,
  );
  assert.equal(decision.lifecycleState, "MAINTAIN");
  assert.equal(decision.desiredShoplingState, "SELLING");
  assert.equal(decision.requiresReview, false);
  assert.equal(decision.reviewReason, null);
});

test("accelerating product expands", () => {
  const decision = evaluateProductLifecycle(
    base({ salesQuantity30: 20, salesQuantity90: 35, salesTrend: "RISING" }),
    NOW,
  );
  assert.equal(decision.lifecycleState, "EXPAND");
});

test("recent zero sales reduces before dormancy", () => {
  const decision = evaluateProductLifecycle(
    base({
      lastSaleAt: "2026-06-20T00:00:00.000Z",
      salesQuantity30: 0,
      salesQuantity90: 4,
      salesQuantity365: 20,
      salesTrend: "FALLING",
    }),
    NOW,
  );
  assert.equal(decision.lifecycleState, "REDUCE");
  assert.equal(decision.purchasePolicy, "NORMAL");
});

test("180 day no-sale product becomes dormant without deleting remaining stock", () => {
  const decision = evaluateProductLifecycle(
    base({
      lastSaleAt: "2026-02-01T00:00:00.000Z",
      salesQuantity30: 0,
      salesQuantity90: 0,
      salesQuantity365: 4,
      inventoryQuantity: 8,
    }),
    NOW,
  );
  assert.equal(decision.lifecycleState, "DORMANT");
  assert.equal(decision.desiredShoplingState, "SELLING");
  assert.equal(decision.purchasePolicy, "STOP");
  assert.ok(decision.nextEvaluationAt);
});

test("dormant product with unverified baseline stays safe without becoming a CEO exception", () => {
  const decision = evaluateProductLifecycle(
    base({
      lastSaleAt: "2026-02-01T00:00:00.000Z",
      salesQuantity30: 0,
      salesQuantity90: 0,
      salesQuantity365: 4,
      inventoryQuantity: 0,
      inventoryConfirmed: false,
      inventoryRequiresReview: false,
      dataStatus: "REVIEW",
    }),
    NOW,
  );
  assert.equal(decision.lifecycleState, "DORMANT");
  assert.equal(decision.desiredShoplingState, "SELLING");
  assert.equal(decision.purchasePolicy, "STOP");
  assert.equal(decision.requiresReview, false);
});

test("dormant zero-stock product uses sold-out instead of permanent deletion", () => {
  const decision = evaluateProductLifecycle(
    base({
      lastSaleAt: "2026-02-01T00:00:00.000Z",
      salesQuantity30: 0,
      salesQuantity90: 0,
      salesQuantity365: 3,
      inventoryQuantity: 0,
    }),
    NOW,
  );
  assert.equal(decision.lifecycleState, "DORMANT");
  assert.equal(decision.desiredShoplingState, "SOLD_OUT");
  assert.equal(decision.destructiveActionEligible, false);
});

test("dormant product receives a bounded re-test window", () => {
  const decision = evaluateProductLifecycle(
    base({
      lastSaleAt: "2026-02-01T00:00:00.000Z",
      salesQuantity30: 0,
      salesQuantity90: 0,
      salesQuantity365: 3,
      inventoryQuantity: 0,
      previous: {
        lifecycleState: "DORMANT",
        desiredShoplingState: "SOLD_OUT",
        purchasePolicy: "STOP",
        warehousePolicy: "TRIM",
        evaluatedAt: "2026-05-01T00:00:00.000Z",
        nextEvaluationAt: "2026-08-01T00:00:00.000Z",
      },
    }),
    NOW,
  );
  assert.equal(decision.lifecycleState, "RETEST");
  assert.equal(decision.desiredShoplingState, "SELLING");
  assert.equal(decision.purchasePolicy, "NORMAL");
});

test("365 day no-sale product can delete only after confirmed zero inventory", () => {
  const lastSale = new Date(Date.parse(NOW) - (DISCONTINUE_AFTER_DAYS + 2) * 86_400_000).toISOString();
  const decision = evaluateProductLifecycle(
    base({
      lastSaleAt: lastSale,
      salesQuantity30: 0,
      salesQuantity90: 0,
      salesQuantity365: 0,
      inventoryQuantity: 0,
      inventoryConfirmed: true,
    }),
    NOW,
  );
  assert.equal(decision.lifecycleState, "DISCONTINUE");
  assert.equal(decision.desiredShoplingState, "DELETE");
  assert.equal(decision.purchasePolicy, "STOP");
  assert.equal(decision.destructiveActionEligible, true);
});

test("365 day no-sale product never deletes when inventory is unverified even when Product Master data is REVIEW", () => {
  const decision = evaluateProductLifecycle(
    base({
      lastSaleAt: "2025-08-01T00:00:00.000Z",
      salesQuantity30: 0,
      salesQuantity90: 0,
      salesQuantity365: 0,
      inventoryQuantity: 0,
      inventoryConfirmed: false,
      dataStatus: "REVIEW",
    }),
    NOW,
  );
  assert.equal(decision.lifecycleState, "DISCONTINUE");
  assert.equal(decision.desiredShoplingState, "SELLING");
  assert.equal(decision.destructiveActionEligible, false);
  assert.equal(decision.requiresReview, true);
  assert.equal(decision.reviewReason, "INVENTORY_NOT_SAFE_FOR_DESTRUCTIVE_ACTION");
});

test("negative or otherwise inconsistent inventory remains an actionable exception", () => {
  const decision = evaluateProductLifecycle(
    base({
      inventoryConfirmed: false,
      inventoryRequiresReview: true,
      dataStatus: "REVIEW",
    }),
    NOW,
  );
  assert.equal(decision.lifecycleState, "MAINTAIN");
  assert.equal(decision.requiresReview, true);
  assert.equal(decision.reviewReason, "INVENTORY_DATA_REVIEW_REQUIRED");
});

test("new unsold item is tested instead of being discontinued", () => {
  const decision = evaluateProductLifecycle(
    base({
      productStatus: "LAUNCHING",
      lastSaleAt: null,
      salesQuantity30: 0,
      salesQuantity90: 0,
      salesQuantity365: 0,
      inventoryQuantity: 20,
    }),
    NOW,
  );
  assert.equal(decision.lifecycleState, "TEST");
  assert.equal(decision.purchasePolicy, "NORMAL");
});
