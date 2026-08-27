import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("legacy registered product requires v5 preparation instead of fake fallback upgrade", async () => {
  const sync = await source("src/lib/seoTitleBulkInventorySync.ts");
  assert.match(sync, /v5_expansion_preparation_required/);
  assert.match(sync, /stagedForNextRegistration/);
  assert.match(sync, /seoFinalOverride/);
  assert.match(sync, /fullGoodsKeys &&\s*!staging/);
  assert.match(sync, /currentFinalTitlesAreConsumed: fullGoodsKeys && !staging/);
});

test("v5 preparation regenerates old FINAL using category gate but does not mutate registered item", async () => {
  const route = await source("src/app/api/seo-title-ledger/prepare-v5/route.ts");
  assert.match(route, /generateKeywordElonBulkFinal/);
  assert.match(route, /mallTitleCategory: category/);
  assert.match(route, /optionText: ""/);
  assert.match(route, /stagedForNextRegistration: registered/);
  assert.match(route, /seoFinal: registered \? null : generatedFinal/);
  assert.match(route, /PREPARE_CONCURRENCY = 2/);
});

test("SEO cloud auto-prepares v5 and only patches unregistered FINALs", async () => {
  const bridge = await source("src/app/seo-bulk-cloud/SeoBulkInventoryReadyReregister.tsx");
  assert.match(bridge, /\/api\/seo-title-ledger\/prepare-v5/);
  assert.match(bridge, /SEO v5 준비 중/);
  assert.match(bridge, /row\.registered === true/);
  assert.match(bridge, /operation: "patch_item"/);
  assert.match(bridge, /SEO v5 카테고리 의도 확장 자동준비/);
  assert.match(bridge, /window\.location\.reload\(\)/);
});

test("approved expansion metadata is hidden from channel lookup and persisted for future inventory", async () => {
  const bulk = await source("src/lib/keywordEngineElonBulkFinal.ts");
  const shopling = await source("src/lib/productLaunchTrackerShopling.ts");
  const sync = await source("src/lib/seoTitleBulkInventorySync.ts");
  assert.match(bulk, /SEO_TITLE_EXPANSION_META_GROUP_KEY = "__seoTitleExpansionV5"/);
  assert.match(bulk, /groupProductNames\[SEO_TITLE_EXPANSION_META_GROUP_KEY\] = JSON\.stringify/);
  assert.match(shopling, /groupNames\[channel\]/);
  assert.doesNotMatch(shopling, /__seoTitleExpansionV5/);
  assert.match(sync, /SEO_TITLE_V5_META_GROUP_KEY = "__seoTitleExpansionV5"/);
  assert.match(sync, /seoTitleV5ExpansionPoolFromLedger/);
});
