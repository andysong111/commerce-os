import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("v5 SEO title inventory revision replaces prior inventory and keeps 30~50B category-intent policy", async () => {
  const sync = await source("src/lib/seoTitleBulkInventorySync.ts");
  const generator = await source("src/lib/seoTitleFinalKeywordInventoryGenerator.ts");

  assert.match(sync, /seo-bulk-cloud-inventory-v5-category-intent-expansion/);
  assert.match(sync, /final10-plus-category-aligned-expansion-v5/);
  assert.match(sync, /titleByteRange: \[30, 50\]/);
  assert.match(sync, /purgeLegacyUnissuedInventory/);
  assert.match(sync, /recoverExpansionPoolFromFinalTitles/);
  assert.match(generator, /MIN_TITLE_BYTES = 30/);
  assert.match(generator, /TARGET_TITLE_BYTES = 42/);
  assert.match(generator, /category-intent-expansion-v5/);
  assert.match(generator, /final-keywords-only-v5-fallback/);
  assert.doesNotMatch(generator, /윤지선작업|예지|하단공지/);
});
