import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, page] = await Promise.all([
  readFile("src/lib/stage8Readiness.ts", "utf8"),
  readFile("src/app/stage8-readiness/page.tsx", "utf8"),
]);

test("Stage8 readiness is composed from canonical Product Master and existing shadow statuses", () => {
  assert.match(engine, /loadProductMasterShoplingSalesStatus/);
  assert.match(engine, /loadProductMasterShoplingSalesIncrementalStatus/);
  assert.match(engine, /loadProductMasterInventoryCostReadiness/);
  assert.match(engine, /loadProductPlanningSnapshot/);
  assert.match(engine, /loadPriceGradeInputSnapshot/);
  assert.match(engine, /loadProductDecisionLiveStatus/);
});

test("opening readiness performs a pure price-grade preview and never stores comparison or business writes", () => {
  assert.match(engine, /comparePriceGradeInputs/);
  assert.match(engine, /stage8-readiness-preview/);
  assert.doesNotMatch(engine, /runPriceGradeShadowComparison/);
  assert.doesNotMatch(engine, /storeComparison/);
  assert.doesNotMatch(engine, /upsert|insert|update|delete|POST|PATCH|PUT/);
  assert.match(engine, /businessWritesEnabled: false/);
});

test("unverified inventory is provisional instead of being treated as stockout or confirmed stock", () => {
  assert.match(engine, /initialZeroUnverifiedCount/);
  assert.match(engine, /미확인 재고는 그림자 계산을 막지 않지만 실제 재고 차감 근거로 사용하지 않습니다/);
  assert.match(page, /미확인 재고는 확인재고 차감에 사용하지 않습니다/);
  assert.doesNotMatch(engine + page, /미확인[^\n]*(?:품절|sold.?out)/i);
});

test("missing receipt cost blocks only affected price actions while allowing Stage8 shadow work", () => {
  assert.match(engine, /missingConfirmedReceiptCostSkuCount/);
  assert.match(engine, /원가 없는 SKU의 가격·마진 조치는 개별 차단/);
  assert.match(engine, /priceGradeShadowAllowed = canonicalFoundationReady/);
  assert.match(engine, /priceGradeActionableInputCount/);
});

test("purchase cutover explicitly prefers canonical Product Master sales over redundant Shopling polling", () => {
  assert.match(engine, /Product Master canonical 판매원장/);
  assert.match(engine, /Shopling 직접조회는 클레임처럼 Product Master에 없는 보조 신호/);
  assert.match(page, /Product Master의 canonical 판매원장에서 직접 읽고/);
});

test("page keeps all actual price, purchase and discontinuation writes disabled", () => {
  assert.match(page, /실제 가격·발주·단종을 실행하지 않습니다/);
  assert.match(page, /업무 쓰기/);
  assert.match(page, /차단/);
  assert.doesNotMatch(page, /onClick|fetch\(|method:\s*["']POST/i);
});
