import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [evidence, engine, page] = await Promise.all([
  readFile("src/data/stage8HistoricalGoodsKeyModelEvidence.ts", "utf8"),
  readFile("src/lib/stage8HistoricalGoodsKeyModelCrosswalk.ts", "utf8"),
  readFile("src/app/stage8-historical-goodskey-model-crosswalk/page.tsx", "utf8"),
]);

test("crosswalk uses current Shopling identity sets and exact historical evidence", () => {
  assert.match(engine, /loadPurchaseCandidateShoplingIdentityAudit/);
  assert.match(engine, /historicalGoodsKeyModelEvidence/);
  assert.match(evidence, /evidenceKind: "ORIGINAL_SHOPLING_MODEL_NO"/);
  assert.match(evidence, /sourceArtifact:/);
  assert.match(evidence, /sourceSheet:/);
});

test("partial coverage and true multi-model B-codes are not collapsed", () => {
  assert.match(engine, /"SINGLE_MODEL_FULL_COVERAGE"/);
  assert.match(engine, /"MULTI_MODEL_FULL_COVERAGE"/);
  assert.match(engine, /"PARTIAL_COVERAGE"/);
  assert.match(engine, /"NO_EVIDENCE"/);
  assert.match(engine, /"MODEL_CONFLICT"/);
  assert.match(engine, /originalModelNos\.length === 1/);
  assert.match(page, /MULTI_MODEL_FULL_COVERAGE/);
  assert.match(page, /모델별 수량·세트 환산 규칙이 증명되기 전에는 합산하지 않습니다/);
});

test("pheasant-glasses evidence preserves two original model families", () => {
  assert.match(evidence, /goodsKey: "116319"[\s\S]*originalModelNo: "aaa090"/);
  assert.match(evidence, /goodsKey: "116325"[\s\S]*originalModelNo: "aaa090"/);
  assert.match(evidence, /goodsKey: "116328"[\s\S]*originalModelNo: "aaa129"/);
  assert.match(evidence, /goodsKey: "116334"[\s\S]*originalModelNo: "aaa129"/);
});

test("pricing cross-match model stays separate from original Shopling model identity", () => {
  assert.match(evidence, /goodsKey: "118206"[\s\S]*originalModelNo: "aaa100"[\s\S]*pricingCrossMatchModelNo: "aaa191"/);
  assert.match(evidence, /goodsKey: "116486"[\s\S]*originalModelNo: "aaa098"[\s\S]*pricingCrossMatchModelNo: "aaa164"/);
  assert.match(engine, /pricingCrossMatchModelNos/);
  assert.match(page, /가격용 교차모델/);
});

test("crosswalk cannot aggregate historical orders or write business state", () => {
  assert.match(engine, /historicalOrderAggregationAllowed: false/);
  assert.match(engine, /inventoryUseAllowed: false/);
  assert.match(engine, /inventoryPromotionAllowed: false/);
  assert.match(engine, /purchaseWritesEnabled: false/);
  assert.match(engine, /inventoryWritesEnabled: false/);
  assert.match(engine, /shoplingWritesEnabled: false/);
  assert.match(page, /INVENTORY \/ PURCHASE WRITE 0/);
  assert.doesNotMatch(engine, /createSupabaseAdminClient/);
  assert.doesNotMatch(engine, /\.(insert|upsert|delete)\(/);
  assert.doesNotMatch(engine, /fetch\(/);
});
