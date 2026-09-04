import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PURCHASE_V2_RULE_VERSION,
  allocatePurchaseV2Portfolio,
  calculatePurchaseV2Product,
} from "../src/lib/productDecisionEngine/purchaseV2.ts";

function revenueFor(units, price = 1_000) {
  return units.map((value) => value * price);
}

function product(overrides = {}) {
  const monthlyUnits = overrides.monthlyUnits ?? Array.from({ length: 12 }, () => 30);
  return {
    barcode: overrides.barcode ?? "BAA1-1",
    name: overrides.name ?? "테스트 상품",
    modelNo: overrides.modelNo ?? "AAA001",
    monthlyUnits,
    monthlyRevenue: overrides.monthlyRevenue ?? revenueFor(monthlyUnits),
    unitCostKrw: overrides.unitCostKrw ?? 100,
    inventorySource: overrides.inventorySource ?? "EXACT_AFTER_STOCKOUT_RESET",
    inventoryLowQuantity: overrides.inventoryLowQuantity ?? 0,
    inventoryHighQuantity: overrides.inventoryHighQuantity ?? 0,
    openCommitmentQuantity: overrides.openCommitmentQuantity ?? 0,
    recent30StockoutDays: overrides.recent30StockoutDays ?? 0,
    feedbackMultiplier: overrides.feedbackMultiplier ?? 1,
  };
}

test("purchase V2 restores stockout-constrained recent demand", () => {
  const units = [20, 30, 28, 27, 29, 30, 28, 27, 29, 30, 28, 27];
  const result = calculatePurchaseV2Product(
    product({
      monthlyUnits: units,
      monthlyRevenue: revenueFor(units),
      recent30StockoutDays: 10,
    }),
  );

  assert.equal(result.ruleVersion, PURCHASE_V2_RULE_VERSION);
  assert.equal(result.observedRecent30Units, 20);
  assert.equal(result.restoredRecent30Units, 30);
  assert.equal(result.stockoutDemandRecovered, 10);
  assert.equal(result.recent30StockoutDays, 10);
});

test("purchase V2 protects a low-revenue product with a persistent rising trend", () => {
  const units = [9, 6, 4, 3, 2, 1, 1, 1, 0, 0, 0, 0];
  const result = calculatePurchaseV2Product(
    product({
      barcode: "BAA1-2",
      monthlyUnits: units,
      monthlyRevenue: revenueFor(units, 800),
      unitCostKrw: 100,
    }),
  );

  assert.equal(result.pattern, "GROWTH");
  assert.ok(result.forecast30Quantity >= result.observedRecent30Units);
  assert.ok(result.score.growth > result.score.stability);
  assert.match(result.reasons.join(" "), /성장형/);
});

test("purchase V2 identifies a consistent seller as stable core", () => {
  const units = [30, 29, 31, 30, 28, 32, 30, 29, 31, 30, 28, 32];
  const result = calculatePurchaseV2Product(
    product({
      barcode: "BAA1-3",
      monthlyUnits: units,
      monthlyRevenue: revenueFor(units, 1_200),
      inventoryLowQuantity: 10,
      inventoryHighQuantity: 10,
    }),
  );

  assert.equal(result.pattern, "STABLE_CORE");
  assert.ok(result.score.stability > result.score.growth);
  assert.match(result.reasons.join(" "), /핵심 안정형/);
});

test("price-cut growth is not treated as fully organic growth", () => {
  const units = [60, 40, 35, 30, 28, 25, 20, 18, 16, 14, 12, 10];
  const discountedRevenue = [
    60 * 700,
    40 * 1_000,
    35 * 1_000,
    ...units.slice(3).map((value) => value * 1_000),
  ];
  const neutralRevenue = revenueFor(units, 1_000);
  const discounted = calculatePurchaseV2Product(
    product({
      barcode: "BAA1-4",
      monthlyUnits: units,
      monthlyRevenue: discountedRevenue,
      unitCostKrw: 100,
    }),
  );
  const neutral = calculatePurchaseV2Product(
    product({
      barcode: "BAA1-5",
      monthlyUnits: units,
      monthlyRevenue: neutralRevenue,
      unitCostKrw: 100,
    }),
  );

  assert.equal(discounted.priceEffect, "DISCOUNT_DRIVEN_GROWTH");
  assert.ok(discounted.forecast30Quantity < neutral.forecast30Quantity);
});

test("MOQ and carton quantity do not round V2 quantity", () => {
  const units = Array.from({ length: 12 }, () => 30);
  const result = calculatePurchaseV2Product(
    product({
      barcode: "BAA1-6",
      monthlyUnits: units,
      monthlyRevenue: revenueFor(units),
      unitCostKrw: 100,
      inventoryLowQuantity: 7,
      inventoryHighQuantity: 7,
    }),
  );

  assert.equal(result.target44Quantity, 44);
  assert.equal(result.lowScenarioNeed, 37);
  assert.equal(result.highScenarioNeed, 37);
  assert.equal(result.recommendedQuantity, 37);
  assert.equal(result.decision, "SMALL_REVIEW");
  assert.equal(result.minimumLineReview, true);
});

test("cash allocation uses urgent then stable then growth then full coverage rounds", () => {
  const stableUnits = Array.from({ length: 12 }, () => 30);
  const growthUnits = [20, 14, 9, 6, 4, 3, 2, 2, 1, 1, 1, 1];
  const stableProbe = calculatePurchaseV2Product(
    product({
      barcode: "BAA2-1",
      monthlyUnits: stableUnits,
      monthlyRevenue: revenueFor(stableUnits),
      unitCostKrw: 500,
    }),
  );
  const growthProbe = calculatePurchaseV2Product(
    product({
      barcode: "BAA2-2",
      monthlyUnits: growthUnits,
      monthlyRevenue: revenueFor(growthUnits),
      unitCostKrw: 500,
    }),
  );
  const stable = calculatePurchaseV2Product(
    product({
      barcode: "BAA2-1",
      monthlyUnits: stableUnits,
      monthlyRevenue: revenueFor(stableUnits),
      unitCostKrw: 500,
      inventoryLowQuantity: stableProbe.target14Quantity,
      inventoryHighQuantity: stableProbe.target14Quantity,
    }),
  );
  const growth = calculatePurchaseV2Product(
    product({
      barcode: "BAA2-2",
      monthlyUnits: growthUnits,
      monthlyRevenue: revenueFor(growthUnits),
      unitCostKrw: 500,
      inventoryLowQuantity: growthProbe.target14Quantity,
      inventoryHighQuantity: growthProbe.target14Quantity,
    }),
  );
  assert.equal(stable.pattern, "STABLE_CORE");
  assert.equal(growth.pattern, "GROWTH");

  const allocation = allocatePurchaseV2Portfolio({
    grossCashBudgetKrw: 60_000,
    purchaseCostMultiplier: 1.45,
    products: [stable, growth],
  });

  assert.equal(allocation.roundSpendKrw.URGENT_14_DAY, 0);
  assert.ok(allocation.roundSpendKrw.STABLE_CORE_30_DAY > 0);
  assert.ok(allocation.roundSpendKrw.GROWTH_30_DAY > 0);
  assert.ok(allocation.expectedAllInSpendKrw <= 60_000);
  assert.ok(allocation.products.every((row) => row.allocatedQuantity <= row.recommendedQuantity));
});

test("purchase V2 pure engine performs no API database or external write", async () => {
  const source = await readFile("src/lib/productDecisionEngine/purchaseV2.ts", "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /supabase|shopling|1688/i);
  assert.doesNotMatch(source, /process\.env/);
  assert.doesNotMatch(source, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
});
