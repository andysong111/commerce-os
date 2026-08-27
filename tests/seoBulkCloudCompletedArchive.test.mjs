import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("goods_key 6/6 전체 보관함 이동은 SEO 대량등록 클라우드에만 제공한다", async () => {
  const bridge = await source("src/app/seo-bulk-cloud/SeoBulkCompletionArchiveBridge.tsx");
  const trackerPage = await source("src/app/product-launch-tracker/page.tsx");

  assert.match(bridge, /EXPECTED_GOODS_KEY_COUNT = 6/);
  assert.match(bridge, /ARCHIVE_BUTTON_ID = "seo-bulk-completed-archive-button"/);
  assert.match(bridge, /등록완료 전체 보관함 이동/);
  assert.match(bridge, /loadFullyRegisteredItemIds/);
  assert.match(bridge, /itemGoodsKeyCount\(item\) === EXPECTED_GOODS_KEY_COUNT/);
  assert.match(bridge, /operation: "archive_items"/);
  assert.match(bridge, /SEO 대량등록 클라우드 전체 보관함 이동/);
  assert.match(bridge, /pruneBatchItems\(completedIds\)/);
  assert.match(bridge, /Shopling에 등록된 상품은 삭제되지 않습니다/);
  assert.match(bridge, /window\.location\.reload\(\)/);
  assert.doesNotMatch(bridge, /shopling-upload/);
  assert.doesNotMatch(trackerPage, /ProductLaunchCompletedArchiveButtonBridge/);
});
