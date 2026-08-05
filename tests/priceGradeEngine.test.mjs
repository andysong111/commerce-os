import assert from "node:assert/strict";
import test from "node:test";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const {
  PRICE_GRADE_RULE_VERSION,
  calculateProtectedReceiptCost,
  calculateProductPriceGrade,
  detectPriceSeasonState,
} = await importTranspiledTypeScript(
  new URL("../src/lib/priceGradeEngine.ts", import.meta.url),
);

const AS_OF = "2026-08-05T00:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;

function dateBefore(days) {
  return new Date(Date.parse(AS_OF) - days * DAY).toISOString();
}

function receipts(costs) {
  return costs.map((cost, index) => ({
    receivedAt: dateBefore(index * 30 + 5),
    unitCostKrw: cost,
  }));
}

function base(overrides = {}) {
  return {
    barcode: "BAA1-1",
    currentPrice: 1000,
    currentGrade: 0,
    launchedAt: dateBefore(400),
    lastSaleAt: dateBefore(3),
    monthlyUnits: Array.from({ length: 24 }, () => 40),
    receipts: receipts([400, 450, 420]),
    active: true,
    asOf: AS_OF,
    ...overrides,
  };
}

test("recent three receipts use the highest cost as the decrease protection cost", () => {
  const result = calculateProtectedReceiptCost(
    [
      ...receipts([400, 550, 450]),
      { receivedAt: dateBefore(500), unitCostKrw: 900 },
    ],
    new Date(AS_OF),
  );
  assert.equal(result.latestCost, 400);
  assert.equal(result.protectionCost, 550);
  assert.equal(result.protectedReceiptCount, 3);
});

test("cost increase below twice latest cost creates a default-selected margin recovery", () => {
  const result = calculateProductPriceGrade(
    base({ currentPrice: 700, receipts: receipts([400, 350, 300]) }),
  );
  assert.equal(result.ruleVersion, PRICE_GRADE_RULE_VERSION);
  assert.equal(result.decision, "increase_required");
  assert.equal(result.recommendedPrice, 800);
  assert.equal(result.defaultSelected, true);
});

test("stable thirty-plus sales promote one five-percent grade step up to plus six", () => {
  const result = calculateProductPriceGrade(
    base({
      currentGrade: 2,
      currentPrice: 1200,
      monthlyUnits: [50, 45, ...Array.from({ length: 22 }, () => 40)],
    }),
  );
  assert.equal(result.grade, 3);
  assert.equal(result.decision, "increase_required");
  assert.equal(result.recommendedPrice, 1380);
  assert.equal(result.adjustmentRate, 0.15);
});

test("minus one and minus two remain observation grades without a price decrease", () => {
  const units = [20, 25, 30, 45, 50, 55, 20, 20, 20, 20, 20, 20, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35];
  const result = calculateProductPriceGrade(base({ monthlyUnits: units }));
  assert.ok(result.grade === -1 || result.grade === -2);
  assert.equal(result.decision, "hold");
  assert.equal(result.recommendedPrice, 1000);
});

test("minus three recommends ten percent first-stage markdown but never below protection cost times two", () => {
  const units = [10, 10, 10, 30, 30, 30, 20, 20, 20, 20, 20, 20, 40, 40, 40, 35, 35, 35, 30, 30, 30, 25, 25, 25];
  const result = calculateProductPriceGrade(
    base({
      currentPrice: 1300,
      monthlyUnits: units,
      lastSaleAt: dateBefore(30),
      receipts: receipts([500, 600, 550]),
    }),
  );
  assert.equal(result.grade, -3);
  assert.equal(result.decision, "decrease_review");
  assert.equal(result.marginFloorPrice, 1200);
  assert.equal(result.recommendedPrice, 1200);
  assert.equal(result.defaultSelected, false);
});

test("minus four recommends thirty percent inventory liquidation and closes at the protected floor", () => {
  const units = [0, 0, 0, 20, 20, 20, 20, 20, 20, 20, 20, 20, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30];
  const result = calculateProductPriceGrade(
    base({
      currentPrice: 2000,
      monthlyUnits: units,
      lastSaleAt: dateBefore(160),
      receipts: receipts([400, 450, 420]),
      discontinued: true,
    }),
  );
  assert.equal(result.grade, -4);
  assert.equal(result.decision, "discontinued_review");
  assert.equal(result.recommendedPrice, 1400);
});

test("seasonal off-season without year-over-year decline cannot fall below minus two", () => {
  const units = [2, 2, 2, 20, 40, 60, 5, 5, 5, 5, 5, 5, 2, 2, 2, 18, 38, 58, 5, 5, 5, 5, 5, 5];
  const result = calculateProductPriceGrade(base({ monthlyUnits: units }));
  assert.ok(["비시즌", "시즌 종료 임박"].includes(detectPriceSeasonState(units)));
  assert.ok(result.grade >= -2);
  assert.notEqual(result.decision, "decrease_review");
  assert.notEqual(result.decision, "discontinued_review");
});

test("new products and incomplete identity fail closed", () => {
  const newProduct = calculateProductPriceGrade(
    base({ launchedAt: dateBefore(30), monthlyUnits: Array(24).fill(100) }),
  );
  assert.equal(newProduct.grade, 0);
  assert.equal(newProduct.decision, "hold");

  const blocked = calculateProductPriceGrade(base({ barcode: "123456" }));
  assert.equal(blocked.decision, "blocked");
  assert.ok(blocked.blockedReasons.includes("위치코드형 바코드 없음"));
});

test("pure price engine contains no database, network or actual Shopling write path", async () => {
  const source = await (await import("node:fs/promises")).readFile(
    "src/lib/priceGradeEngine.ts",
    "utf8",
  );
  assert.doesNotMatch(source, /fetch\(|supabase|process\.env/i);
  assert.doesNotMatch(source, /insert\(|update\(|delete\(|upsert\(/i);
  assert.doesNotMatch(source, /shopling|1688/i);
});
