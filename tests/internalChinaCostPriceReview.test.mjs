import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildInternalChinaCostPriceDecision,
  costDefensePrice,
} from "../src/lib/internalChinaCostPricePolicy.ts";

const [review, approvalRoute, dispatcherRoute, reviewPage, receiptPanel] =
  await Promise.all([
    readFile("src/lib/internalChinaCostPriceReview.ts", "utf8"),
    readFile(
      "src/app/api/china-order-manager/price-review/approve/route.ts",
      "utf8",
    ),
    readFile("src/app/api/cron/receipt-live-price-proposals/route.ts", "utf8"),
    readFile("src/app/china-order-manager/price-review/page.tsx", "utf8"),
    readFile(
      "src/components/china-order-manager/InternalChinaReceiptPanel.tsx",
      "utf8",
    ),
  ]);

test("cost defense raises price when current price is below confirmed-cost floor", () => {
  const result = buildInternalChinaCostPriceDecision({
    currentPrice: 1000,
    latestCostKrw: 600,
    previousCostKrw: 500,
  });
  assert.equal(result.targetPrice, 1200);
  assert.equal(result.direction, "INCREASE");
  assert.equal(result.changeRequired, true);
});

test("confirmed cost drop can lower price to the new two-times cost floor", () => {
  const result = buildInternalChinaCostPriceDecision({
    currentPrice: 1500,
    latestCostKrw: 500,
    previousCostKrw: 700,
  });
  assert.equal(result.targetPrice, 1000);
  assert.equal(result.direction, "DECREASE");
  assert.equal(result.changeRequired, true);
});

test("first confirmed cost never causes an automatic markdown", () => {
  const result = buildInternalChinaCostPriceDecision({
    currentPrice: 1500,
    latestCostKrw: 500,
    previousCostKrw: null,
  });
  assert.equal(result.targetPrice, 1000);
  assert.equal(result.direction, "HOLD");
  assert.equal(result.changeRequired, false);
});

test("unchanged cost with sufficient margin holds current price", () => {
  const result = buildInternalChinaCostPriceDecision({
    currentPrice: 1000,
    latestCostKrw: 500,
    previousCostKrw: 500,
  });
  assert.equal(result.targetPrice, 1000);
  assert.equal(result.direction, "HOLD");
  assert.equal(result.changeRequired, false);
});

test("missing current price is fail-closed", () => {
  const result = buildInternalChinaCostPriceDecision({
    currentPrice: 0,
    latestCostKrw: 500,
    previousCostKrw: 700,
  });
  assert.equal(result.direction, "BLOCKED");
  assert.equal(result.blockedReason, "CURRENT_PRICE_MISSING");
  assert.equal(result.changeRequired, false);
});

test("multi-unit listings defend the cost of every unit sold in one order", () => {
  assert.equal(costDefensePrice(500, 3), 3000);
  const result = buildInternalChinaCostPriceDecision({
    currentPrice: 2500,
    latestCostKrw: 500,
    previousCostKrw: 450,
    unitsPerOrder: 3,
  });
  assert.equal(result.unitsPerOrder, 3);
  assert.equal(result.targetPrice, 3000);
  assert.equal(result.direction, "INCREASE");
});

test("internal China pricing is cost-only and never imports the product-grade engine", () => {
  assert.ok(review.includes('INTERNAL_CHINA_COST_PRICE_PROPOSAL'));
  assert.ok(review.includes('INTERNAL_CHINA_COST_PRICE_APPROVAL'));
  assert.ok(review.includes('shoplingWritesEnabled: false'));
  assert.ok(review.includes('buildInternalChinaCostPriceDecision'));
  assert.equal(review.includes('priceGradeEngine'), false);
  assert.equal(review.includes('productGrade'), false);
  assert.ok(reviewPage.includes('상품등급·매출등급은 사용하지 않습니다'));
});

test("approval records intent only and does not write Shopling prices", () => {
  assert.ok(approvalRoute.includes('approveInternalChinaCostPriceProposal'));
  assert.ok(approvalRoute.includes('실제 Shopling 판매가격은 아직 변경하지 않습니다'));
  assert.equal(approvalRoute.includes('shoplingApply'), false);
  assert.equal(approvalRoute.includes('savePrice'), false);
});

test("existing dispatcher generates cost-only proposal before legacy receipt proposal", () => {
  const costIndex = dispatcherRoute.indexOf('runInternalChinaCostPriceProposalStep');
  const legacyIndex = dispatcherRoute.indexOf('runReceiptLivePriceProposalStep');
  assert.ok(costIndex >= 0);
  assert.ok(legacyIndex > costIndex);
  assert.ok(dispatcherRoute.includes('flow: "internal_china_cost_price"'));
  assert.ok(dispatcherRoute.includes('productGradeUsed: false'));
  assert.ok(dispatcherRoute.includes('shoplingPriceWritesEnabled: false'));
});

test("landed-cost close hands off to price review without product-grade wording", () => {
  assert.ok(receiptPanel.includes('가격조정 검토'));
  assert.ok(receiptPanel.includes('/china-order-manager/price-review'));
  assert.equal(receiptPanel.includes('가격조정·상품등급'), false);
});
