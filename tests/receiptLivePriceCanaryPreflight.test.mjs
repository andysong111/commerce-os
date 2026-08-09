import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, cron, page, vercel] = await Promise.all([
  readFile("src/lib/receiptLivePriceCanaryPreflight.ts", "utf8"),
  readFile("src/app/api/cron/receipt-live-price-canary-preflight/route.ts", "utf8"),
  readFile("src/app/stage8-receipt-live-price-canary-preflight/page.tsx", "utf8"),
  readFile("vercel.json", "utf8"),
]);

test("preflight deterministically selects exactly one eligible goods key", () => {
  assert.match(engine, /row\.canaryEligible/);
  assert.match(engine, /row\.adjustmentBps !== null/);
  assert.match(engine, /row\.changedListingCount > 0/);
  assert.match(engine, /Number\(left\.goodsKey\) - Number\(right\.goodsKey\)/);
  assert.match(engine, /\)\[0\]/);
});

test("preflight dispatches only the existing read-only Shopling plan", () => {
  assert.match(engine, /dispatchShoplingPriceAdjustmentPlan/);
  assert.match(engine, /fetchShoplingPriceAdjustmentPlanResult/);
  assert.match(engine, /goods_key: candidate\.goodsKey\.goodsKey/);
  assert.match(engine, /adjustment_bps: candidate\.goodsKey\.adjustmentBps/);
  assert.doesNotMatch(engine, /dispatchShoplingPriceAdjustmentOptionCanary|dispatchShoplingPriceAdjustmentCanary/);
  assert.match(engine, /canaryWritesEnabled: false/);
});

test("proposal current base and option amounts must exactly match the fresh read-only plan", () => {
  assert.match(engine, /RECEIPT_CANARY_LIVE_BASE_PRICE_DRIFT/);
  assert.match(engine, /RECEIPT_CANARY_LIVE_OPTION_AMOUNT_DRIFT/);
  assert.match(engine, /RECEIPT_CANARY_CURRENT_EFFECTIVE_PRICE_DRIFT/);
  assert.match(engine, /basePrices\.length !== 1/);
  assert.match(engine, /arraysEqual\(proposalCurrentOptionAmounts, currentOptionAmounts\)/);
});

test("proposal target effective prices must exactly match the plan target", () => {
  assert.match(engine, /RECEIPT_CANARY_TARGET_PRICE_MISMATCH/);
  assert.match(engine, /planTargetEffective/);
  assert.match(engine, /proposalTargetEffective/);
  assert.match(engine, /arraysEqual\(proposalTargetEffective, planTargetEffective\)/);
});

test("preflight pins the exact stale-check inputs needed by the future option-aware canary", () => {
  assert.match(engine, /expectedCurrentSellPrice/);
  assert.match(engine, /expectedOptionSignature/);
  assert.match(engine, /currentOptionAmounts/);
  assert.match(engine, /targetOptionAmounts/);
  assert.match(engine, /OPTION_AWARE_ONE_GOODS_KEY/);
  assert.match(engine, /SHA256\.test\(optionSignature\)/);
});

test("preflight cron is protected, periodic, and never performs a price write", () => {
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /runReceiptLivePriceCanaryPreflightStep/);
  assert.match(cron, /actualShoplingPriceWrites: 0/);
  assert.match(cron, /canaryWritesEnabled: false/);
  assert.match(page, /실제 가격 write/);
  assert.match(page, /Canary write/);
  assert.match(page, /OPERATOR APPROVAL NOT OPEN/);
  assert.match(vercel, /receipt-live-price-canary-preflight/);
});
