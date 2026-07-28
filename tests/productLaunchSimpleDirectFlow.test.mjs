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

test("normal flow preserves the intended operational order and no market transmission", async () => {
  const component = await readFile(componentPath, "utf8");
  const upload = component.indexOf("/api/shopling-product-upload/run");
  const price = component.indexOf("/api/shopling-price-modify/run");
  const direct = component.indexOf("/api/keyword-shopling-direct-apply/run");
  assert.ok(upload >= 0);
  assert.ok(price > upload);
  assert.ok(direct > price);
  assert.match(component, /마켓 전송은 자동으로 실행하지 않습니다/);
  assert.doesNotMatch(component, /market.*dispatch|send.*market/i);
});

test("normal flow requires exact preflight coverage before direct apply", async () => {
  const component = await readFile(componentPath, "utf8");
  assert.match(component, /coverageMismatchGoodsKeyCount/);
  assert.match(component, /generatedTitleTargetCount/);
  assert.match(component, /expectedTitleTargetCount/);
  assert.match(component, /blockedCount/);
  assert.match(component, /rawKeywords\(searches/);
  assert.match(component, /length === 10/);
});
