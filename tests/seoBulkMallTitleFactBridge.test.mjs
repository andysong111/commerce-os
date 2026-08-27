import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("SEO bulk 쇼핑몰별 상품명은 FACT 브리지 없이 확정 FINAL 키워드만 사용한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const bulk = await source("src/lib/keywordEngineElonBulkFinal.ts");
  const composer = await source("src/lib/keywordEngineElonMallTitleSafeComposer.ts");

  assert.doesNotMatch(page, /SeoBulkMallTitleFactBridge/);
  assert.match(bulk, /const searchKeywords = recoveredSearchKeywords/);
  assert.match(bulk, /composeKeywordElonSafeMallTitles/);
  assert.match(bulk, /finalKeywords: searchKeywords/);
  assert.doesNotMatch(bulk, /diversifyKeywordElonMallTitles/);

  assert.match(composer, /final-keywords-only-v4-min-length/);
  assert.match(composer, /MIN_TITLE_BYTES = 30/);
  assert.match(composer, /TARGET_TITLE_BYTES = 42/);
  assert.match(composer, /facts: \[\]/);
  assert.doesNotMatch(composer, /detailHtml.*matchAll|mainImageUrl.*match|additionalImageUrls.*flatMap/);
});
