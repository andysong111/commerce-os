import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("v5 SEO title inventory revision replaces prior inventory and keeps 30~50B category-intent policy", async () => {
  const sync = await source("src/lib/seoTitleBulkInventorySync.ts");
  const generator = await source("src/lib/seoTitleFinalKeywordInventoryGenerator.ts");
  const bulk = await source("src/lib/keywordEngineElonBulkFinal.ts");

  assert.match(sync, /seo-bulk-cloud-inventory-v5-category-intent-expansion/);
  assert.match(sync, /final10-plus-category-aligned-expansion-v5/);
  assert.match(sync, /titleByteRange: \[30, 50\]/);
  assert.match(sync, /purgeLegacyUnissuedInventory/);
  assert.match(sync, /expansionPoolFromCurrentSeoFinal/);
  assert.match(sync, /expansionPoolFromExistingLedger/);
  assert.match(sync, /TITLE_EXPANSION_META_GROUP_KEY = "__seoTitleExpansionV5"/);
  assert.match(sync, /TRUSTED_V5_FINAL_SOURCE = "seo-bulk-cloud-category-intent-v5"/);
  assert.match(sync, /text\(seoFinal\.source\) !== TRUSTED_V5_FINAL_SOURCE/);
  assert.match(sync, /record\(ledger\.source_payload\)\.titleExpansionPool/);

  assert.match(bulk, /SEO_FINAL_SOURCE_V5 = "seo-bulk-cloud-category-intent-v5"/);
  assert.match(bulk, /SEO_TITLE_EXPANSION_META_GROUP_KEY = "__seoTitleExpansionV5"/);
  assert.match(bulk, /groupProductNames\[SEO_TITLE_EXPANSION_META_GROUP_KEY\] = JSON\.stringify/);
  assert.match(bulk, /source: SEO_FINAL_SOURCE_V5/);

  assert.match(generator, /MIN_TITLE_BYTES = 30/);
  assert.match(generator, /TARGET_TITLE_BYTES = 42/);
  assert.match(generator, /category-intent-expansion-v5/);
  assert.match(generator, /final-keywords-only-v5-fallback/);
  assert.doesNotMatch(generator, /윤지선작업|예지|하단공지/);
});
