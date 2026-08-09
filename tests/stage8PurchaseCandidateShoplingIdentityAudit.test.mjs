import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, page] = await Promise.all([
  readFile("src/lib/stage8PurchaseCandidateShoplingIdentityAudit.ts", "utf8"),
  readFile("src/app/stage8-purchase-candidate-shopling-identity-audit/page.tsx", "utf8"),
]);

test("audit joins purchase-candidate recovery evidence to current planning listings", () => {
  assert.match(engine, /loadPurchaseCandidateLegacyModelRecovery/);
  assert.match(engine, /loadProductPlanningSnapshot/);
  assert.match(engine, /plan\?\.listings/);
  assert.match(engine, /goodsKey/);
  assert.match(engine, /optionId/);
  assert.match(engine, /unitsPerOrder/);
});

test("any nonempty active goods-key set is ready and multiple listings are informational", () => {
  assert.match(engine, /"IDENTITY_SET_READY"/);
  assert.match(engine, /"NO_ACTIVE_LISTING"/);
  assert.match(engine, /goodsKeys\.length > 0/);
  assert.match(engine, /multiGoodsKeyCount/);
  assert.doesNotMatch(engine, /AMBIGUOUS_GOODS_KEY/);
  assert.match(page, /MULTI GOODS_KEY IS NORMAL LISTING SCOPE · NOT IDENTITY AMBIGUITY/);
});

test("goods key evidence cannot promote an aaa model or business state", () => {
  assert.match(engine, /historicalModelJoinAllowed: false/);
  assert.match(engine, /inventoryPromotionAllowed: false/);
  assert.match(engine, /purchaseWritesEnabled: false/);
  assert.match(engine, /inventoryWritesEnabled: false/);
  assert.match(engine, /shoplingWritesEnabled: false/);
  assert.match(page, /goods_key 집합 연결 ≠ aaa 모델번호 확정/);
  assert.match(page, /BUSINESS WRITE 0/);
});

test("audit remains read only", () => {
  assert.doesNotMatch(engine, /createSupabaseAdminClient/);
  assert.doesNotMatch(engine, /\.from\(/);
  assert.doesNotMatch(engine, /\.(insert|upsert|delete)\(/);
  assert.doesNotMatch(engine, /fetch\(/);
});
