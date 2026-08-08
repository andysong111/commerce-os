import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [evidence, readiness, page] = await Promise.all([
  readFile("src/data/stage8LegacyVerifiedCostEvidence.ts", "utf8"),
  readFile("src/lib/stage8LegacyVerifiedCostReadiness.ts", "utf8"),
  readFile("src/app/stage8-legacy-verified-cost-readiness/page.tsx", "utf8"),
]);

test("legacy evidence is explicit purchase-only evidence and never receipt truth", () => {
  assert.match(evidence, /LEGACY_VERIFIED_COST_EVIDENCE/);
  assert.match(evidence, /purchaseUseAllowed: true/);
  assert.match(evidence, /priceUseAllowed: false/);
  assert.match(evidence, /confirmedReceiptUseAllowed: false/);
  assert.match(evidence, /inventoryWriteAllowed: false/);
  assert.doesNotMatch(evidence, /CONFIRMED_RECEIPT_EVIDENCE/);
});

test("curated evidence contains only explicit A-confidence canonical mappings", () => {
  for (const code of ["BGG1-1", "BGE1-1", "BGE2-1", "BGD2-1", "BAC3-1", "BAE1-3"]) {
    assert.match(evidence, new RegExp(`barcode: "${code}"`));
  }
  assert.match(evidence, /confidence: "A"/);
  assert.doesNotMatch(evidence, /BAB5-1|BAB2-1|BAG4-2|BAC4-2|BCA4-1/);
});

test("purchase cost can only stay equal or become more conservative", () => {
  assert.match(readiness, /Math\.max\(shadowUnitCost, evidenceCost\)/);
  assert.match(readiness, /Math\.ceil\(evidence\.unitCostKrw\)/);
  assert.match(readiness, /effectivePurchaseUnitCostKrw \* recommendedQty/);
});

test("legacy evidence cannot make an unverified inventory operationally ready", () => {
  assert.match(readiness, /inventoryVerified = row\.inventoryVerified && !row\.inventoryRequiresReview/);
  assert.match(readiness, /operationallyReady = purchaseCostTrusted && inventoryVerified/);
  assert.match(readiness, /immediateStocktakeEligible/);
});

test("readiness and page remain read-only across price inventory receipt and business writes", () => {
  assert.match(readiness, /priceUseAllowed: false/);
  assert.match(readiness, /confirmedReceiptUseAllowed: false/);
  assert.match(readiness, /inventoryWritesEnabled: false/);
  assert.match(readiness, /businessWritesEnabled: false/);
  assert.match(page, /0 · READ ONLY/);
  assert.doesNotMatch(`${readiness}\n${page}`, /method:\s*["']POST["']|upsertRows|insert\(|update\(|delete\(/);
});
