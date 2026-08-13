import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routePath = new URL(
  "../src/app/api/product-launch-tracker/migrations/shopling-location-code-backfill-20260814/route.ts",
  import.meta.url,
);
const source = readFileSync(routePath, "utf8");

test("B 위치코드 백필은 정규화 상품·옵션 행을 페이지 단위로 읽는다", () => {
  assert.match(source, /readProductLaunchNormalizedState/);
  assert.match(source, /NORMALIZED_ITEM_PAGE_SIZE = 50/);
  assert.match(source, /NORMALIZED_OPTION_PAGE_SIZE = 200/);
  assert.match(source, /Range: `\$\{offset\}-\$\{end\}`/);
  assert.match(source, /stateSource: "normalized" \| "canonical"/);
});

test("B 위치코드 백필 저장은 목록 스냅샷과 작은 PATCH 응답을 유지한다", () => {
  assert.match(source, /withProductLaunchListSnapshot\(\{/);
  assert.match(source, /select: "updated_at,schema_version"/);
  assert.match(source, /syncProductLaunchNormalizedChangedItems/);
  assert.doesNotMatch(source, /syncProductLaunchNormalizedFull\(/);
});
