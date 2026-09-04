import test from "node:test";
import assert from "node:assert/strict";
import { purchaseV2FeedbackMultiplier } from "../src/lib/purchaseV2Feedback.ts";

test("underforecast raises only ten percent per cycle", () => {
  const multiplier = purchaseV2FeedbackMultiplier({
    previousMonthlyForecast: 100,
    previousFeedbackMultiplier: 1,
    actualRecent30Units: 160,
  });
  assert.equal(multiplier, 1.06);
  assert.ok(multiplier <= 1.1);
});

test("large underforecast is capped to a ten percent one-cycle step", () => {
  const multiplier = purchaseV2FeedbackMultiplier({
    previousMonthlyForecast: 20,
    previousFeedbackMultiplier: 1,
    actualRecent30Units: 100,
  });
  assert.equal(multiplier, 1.1);
});

test("overforecast reduces gradually and cumulative correction remains bounded", () => {
  const multiplier = purchaseV2FeedbackMultiplier({
    previousMonthlyForecast: 100,
    previousFeedbackMultiplier: 0.8,
    actualRecent30Units: 10,
  });
  assert.equal(multiplier, 0.75);
});

test("stockout-corrected or materially repriced cycles are excluded from learning", () => {
  assert.equal(
    purchaseV2FeedbackMultiplier({
      previousMonthlyForecast: 100,
      previousFeedbackMultiplier: 1.05,
      actualRecent30Units: 150,
      previousStockoutRecoveredUnits: 20,
    }),
    1.05,
  );
  assert.equal(
    purchaseV2FeedbackMultiplier({
      previousMonthlyForecast: 100,
      previousFeedbackMultiplier: 0.95,
      actualRecent30Units: 150,
      previousPriceChangeRate: -12,
    }),
    0.95,
  );
});
