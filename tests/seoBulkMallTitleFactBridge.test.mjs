import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("상품 FACT 보강은 compose_bulk_final에만 붙고 최종키워드 생성 단계는 건드리지 않는다", async () => {
  const bridge = await source("src/app/seo-bulk-cloud/SeoBulkMallTitleFactBridge.tsx");
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const bulk = await source("src/lib/keywordEngineElonBulkFinal.ts");

  assert.match(page, /SeoBulkMallTitleFactBridge/);
  assert.match(bridge, /text\(body\.action\) !== "compose_bulk_final"/);
  assert.match(bridge, /optionText: \[existingOptionText, \.\.\.facts\]/);
  assert.match(bridge, /detailPageAsset/);
  assert.match(bridge, /mainImageUrl/);
  assert.match(bridge, /shoplingCategory/);
  assert.doesNotMatch(bridge, /discover_keywords|score_keywords|filter_prohibited_keywords|generate_title/);

  assert.match(bulk, /const searchKeywords = recoveredSearchKeywords/);
  assert.match(bulk, /composeKeywordElonSafeMallTitles/);
  assert.doesNotMatch(bulk, /diversifyKeywordElonMallTitles/);
  assert.match(bulk, /finalKeywords: searchKeywords/);
});
