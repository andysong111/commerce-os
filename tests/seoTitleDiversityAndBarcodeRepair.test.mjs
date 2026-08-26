import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("SEO 쇼핑몰 상품명 다양화는 검증된 키워드·상품 정체성 재료만 사용한다", async () => {
  const diversity = await source("src/lib/keywordEngineElonMallTitleDiversity.ts");
  const bulk = await source("src/lib/keywordEngineElonBulkFinal.ts");

  assert.match(diversity, /groundedMaterials/);
  assert.match(diversity, /searchKeywords\.flatMap/);
  assert.match(diversity, /functionModifiers/);
  assert.match(diversity, /designShapeModifiers/);
  assert.match(diversity, /specAttributes/);
  assert.match(diversity, /isNearDuplicate/);
  assert.match(diversity, /similarity\(remainder, other\) >= 0\.82/);
  assert.match(diversity, /KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT/);
  assert.match(diversity, /modelOccurrenceCount\(cleaned, modelName\) === 1/);
  assert.doesNotMatch(diversity, /인기|베스트|최고|추천상품|프리미엄/);

  assert.match(bulk, /diversifyKeywordElonMallTitles/);
  assert.match(bulk, /const mallTitles = diversity\.rows/);
  assert.match(bulk, /\.\.\.diversity\.warnings/);
});

test("옵션바코드NO resolver는 RETURNS TABLE 변수와 충돌하지 않는 PK constraint를 사용한다", async () => {
  const migration = await source(
    "supabase/migrations/202608260001_fix_option_barcode_resolver_ambiguity.sql",
  );

  assert.match(
    migration,
    /on conflict on constraint option_barcode_registry_pkey do nothing/,
  );
  assert.doesNotMatch(migration, /on conflict \(identity_key\) do nothing/);
  assert.match(migration, /where btrim\(o\.barcode\) <> ''/);
  assert.match(migration, /optionBarcodeIdentityKind', 'B_CODE'/);
  assert.match(migration, /product_launch_tracker_states/);
});
