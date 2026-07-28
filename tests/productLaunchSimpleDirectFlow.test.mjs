import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath =
  "src/components/product-launch-flow/ProductLaunchFlowSimple.tsx";
const pagePath = "src/app/product-launch-flow/page.tsx";
const legacyPath = "src/app/product-launch-flow/legacy/page.tsx";

test("default product launch page uses the simplified direct flow", async () => {
  const page = await readFile(pagePath, "utf8");
  assert.match(page, /ProductLaunchFlowSimple/);
  assert.doesNotMatch(page, /import \{ ProductLaunchFlow \}/);
});

test("legacy workaround screen remains isolated under developer route", async () => {
  const legacy = await readFile(legacyPath, "utf8");
  assert.match(legacy, /ProductLaunchFlow/);
  assert.match(legacy, /이전 진단 화면/);
});

test("normal flow dispatches direct apply and never performs final price repair", async () => {
  const component = await readFile(componentPath, "utf8");
  assert.match(component, /keyword-shopling-direct-apply\/run/);
  assert.match(component, /APPLY_REVIEWED_TITLES_AND_SEARCH_TO_SHOPLING/);
  assert.doesNotMatch(component, /keywordShoplingDirectApplyRunner/);
  assert.doesNotMatch(component, /runFinalPriceModify/);
  assert.doesNotMatch(component, /manual_canary/);
  assert.doesNotMatch(component, /manual_remaining/);
  assert.doesNotMatch(component, /CONFIRM_MANUAL_CANARY_VISIBLE_AND_PRICE_OK/);
  assert.doesNotMatch(component, /finalize_after_keyword_apply/);
});

test("normal flow runs recommendations between price and direct apply without market transmission", async () => {
  const component = await readFile(componentPath, "utf8");
  const upload = component.indexOf("/api/shopling-product-upload/run");
  const price = component.indexOf("/api/shopling-price-modify/run");
  const recommendation = component.indexOf(
    "/api/product-launch-keyword-recommendations/run",
  );
  const direct = component.indexOf("/api/keyword-shopling-direct-apply/run");
  assert.ok(upload >= 0);
  assert.ok(price > upload);
  assert.ok(recommendation > price);
  assert.ok(direct > recommendation);
  assert.match(component, /마켓 전송은 자동으로 실행하지 않습니다/);
  assert.doesNotMatch(component, /market.*dispatch|send.*market/i);
});

test("keyword recommendations appear above inputs with click and optimized apply actions", async () => {
  const component = await readFile(componentPath, "utf8");
  assert.match(component, /키워드 엔진 추천/);
  assert.match(component, /전체 상품 최적화 자동 적용/);
  assert.match(component, /이 상품 최적화 적용/);
  assert.match(component, /toggleRecommendedKeyword/);
  assert.match(component, /applyOptimizedRecommendedKeywords/);
  assert.match(component, /초록색은 엔진 최적 키워드/);
  assert.ok(
    component.indexOf("2. 추천키워드 선택") <
      component.indexOf("3. 상품명·검색어 후보 입력"),
  );
});

test("normal flow requires exact preflight coverage before direct apply", async () => {
  const component = await readFile(componentPath, "utf8");
  assert.match(component, /coverageMismatchGoodsKeyCount/);
  assert.match(component, /generatedTitleTargetCount/);
  assert.match(component, /expectedTitleTargetCount/);
  assert.match(component, /blockedCount/);
  assert.match(component, /rawKeywords\(searches/);
  assert.match(component, /length === 10/);
  assert.match(component, /100bytes/);
});

test("normal flow restores all request IDs and results after refresh", async () => {
  const component = await readFile(componentPath, "utf8");
  assert.match(component, /readProductLaunchSimpleSession/);
  assert.match(component, /writeProductLaunchSimpleSession/);
  assert.match(component, /setUploadRequestId\(restored\.uploadRequestId\)/);
  assert.match(component, /setPriceRequestId\(restored\.priceRequestId\)/);
  assert.match(
    component,
    /setRecommendationRequestId\(restored\.recommendationRequestId\)/,
  );
  assert.match(component, /setDirectRequestId\(restored\.directRequestId\)/);
  assert.match(component, /if \(!hydrated \|\| !uploadRequestId/);
  assert.match(component, /if \(!hydrated \|\| !priceRequestId/);
  assert.match(component, /!recommendationRequestId/);
  assert.match(component, /if \(!hydrated \|\| !directRequestId/);
});

test("normal flow rejects partial uploads and invalidates stale async completions", async () => {
  const component = await readFile(componentPath, "utf8");
  assert.match(component, /isSuccessfulSimpleUploadResult\(uploadResult\)/);
  assert.match(component, /operationEpoch/);
  assert.match(component, /operationEpoch\.current !== epoch/);
  assert.match(component, /disabled=\{resetDisabled\}/);
  assert.match(component, /상품업로드 전체가 성공하지 않아/);
});
