import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const buttonPath =
  "src/components/product-launch-flow/KeywordRecommendationRerunButton.tsx";
const pagePath = "src/app/product-launch-flow/page.tsx";

test("product launch page exposes current recommendation rerun control", async () => {
  const page = await readFile(pagePath, "utf8");
  assert.match(page, /KeywordRecommendationRerunButton/);
  assert.ok(
    page.indexOf("KeywordRecommendationRerunButton") <
      page.indexOf("ProductLaunchFlowSimple"),
  );
});

test("rerun control preserves launch fields and clears only recommendation state", async () => {
  const source = await readFile(buttonPath, "utf8");
  assert.match(source, /PRODUCT_LAUNCH_SIMPLE_SESSION_KEY/);
  assert.match(source, /recommendationRequestId: ""/);
  assert.match(source, /recommendationResult: null/);
  assert.match(source, /recommendationPolls: 0/);
  assert.match(source, /window\.location\.reload\(\)/);
  assert.doesNotMatch(source, /uploadRequestId: ""/);
  assert.doesNotMatch(source, /priceRequestId: ""/);
  assert.doesNotMatch(source, /titles: \{\}/);
  assert.doesNotMatch(source, /searches: \{\}/);
});

test("rerun control is unavailable after direct apply starts", async () => {
  const source = await readFile(buttonPath, "utf8");
  assert.match(source, /text\(session\.directRequestId\) \|\| session\.directResult/);
  assert.match(source, /현재 상품 추천 다시 만들기/);
  assert.match(source, /상품업로드·가격설정·입력값은 유지/);
});
