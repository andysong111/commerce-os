import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("SEO bulk 쇼핑몰별 상품명은 FACT 브리지 없이 FINAL10 + 카테고리 검증 확장재료만 사용한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const bulk = await source("src/lib/keywordEngineElonBulkFinal.ts");
  const composer = await source("src/lib/keywordEngineElonMallTitleSafeComposer.ts");
  const expansion = await source("src/lib/keywordEngineElonTitleExpansion.ts");

  assert.doesNotMatch(page, /SeoBulkMallTitleFactBridge/);
  assert.match(bulk, /const searchKeywords = recoveredSearchKeywords/);
  assert.match(bulk, /buildKeywordElonTitleExpansionPool/);
  assert.match(bulk, /finalKeywords: searchKeywords/);
  assert.match(bulk, /titleExpansionPool/);
  assert.doesNotMatch(bulk, /diversifyKeywordElonMallTitles/);

  assert.match(composer, /category-intent-expansion-v5/);
  assert.match(composer, /final-keywords-only-v5-fallback/);
  assert.match(composer, /MIN_TITLE_BYTES = 30/);
  assert.match(composer, /TARGET_TITLE_BYTES = 42/);
  assert.match(composer, /facts: \[\]/);
  assert.match(composer, /origin: "category_expansion"/);
  assert.doesNotMatch(composer, /detailHtml.*matchAll|mainImageUrl.*match|additionalImageUrls.*flatMap/);
  assert.match(expansion, /KEYWORD_ELON_CATEGORY_MATCH_GATE = 85/);
  assert.match(expansion, /competitionOpportunity/);
  assert.match(expansion, /intentClass/);
});
