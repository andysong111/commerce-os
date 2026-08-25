import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("독립 상품 편집기는 최초 조회는 authoritative legacy, 저장/검증은 direct item API를 사용한다", async () => {
  const page = await source("src/app/product-launch-editor/page.tsx");
  const transport = await source("src/app/product-launch-editor/ProductLaunchEditorTransport.tsx");
  assert.match(page, /ProductLaunchEditorTransport/);
  assert.match(transport, /normalized-optimized/);
  assert.match(transport, /AUTHORITATIVE_LEGACY_API = "\/api\/product-launch-tracker\/optimized"/);
  assert.match(transport, /DIRECT_ITEM_API = "\/api\/product-launch-tracker\/item-editor"/);
  assert.match(transport, /method === "PATCH" \|\| directReadback/);
  assert.match(transport, /window\.fetch = routedFetch/);
});

test("direct item API는 정규화 item\/options를 먼저 저장하고 legacy mirror는 응답 밖에서 실행한다", async () => {
  const route = await source("src/app/api/product-launch-tracker/item-editor/route.ts");
  assert.match(route, /readProductLaunchNormalizedItem/);
  assert.match(route, /applyProductLaunchTrackerMutation/);
  assert.match(route, /writeNormalizedItem/);
  assert.match(route, /product_launch_items/);
  assert.match(route, /product_launch_options/);
  assert.match(route, /after\(async \(\) =>/);
  assert.match(route, /mirrorToLegacy/);
  assert.match(route, /legacyMirrorQueued: true/);
});

test("direct item API는 기준판매가와 원가를 option 정규화 행에 직접 기록한다", async () => {
  const route = await source("src/app/api/product-launch-tracker/item-editor/route.ts");
  assert.match(route, /base_sale_price_krw: nonNegativeInteger\(option\.baseSalePriceKrw\)/);
  assert.match(route, /unit_cost_krw: nonNegativeInteger\(option\.unitCostKrw\)/);
  assert.match(route, /option_payload: cloneRecord\(option\)/);
});
