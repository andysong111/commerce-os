import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("SEO 대량등록 화면은 goods_key 6/6 완료 상품을 화면에서 자동 숨김 처리한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const bridge = await source("src/app/seo-bulk-cloud/SeoBulkCompletionArchiveBridge.tsx");
  assert.match(page, /SeoBulkCompletionArchiveBridge/);
  assert.match(bridge, /goods\[_ \]\?key/);
  assert.match(bridge, /6개\\s\*등록됨/);
  assert.match(bridge, /data-seo-bulk-goods-key-complete/);
  assert.match(bridge, /article\.style\.display = "none"/);
  assert.match(bridge, /MutationObserver/);
});

test("완료 여부와 무관하게 현재 배치의 FINAL 상품명은 영구 상품명 재고 원장으로 백그라운드 동기화한다", async () => {
  const bridge = await source("src/app/seo-bulk-cloud/SeoBulkCompletionArchiveBridge.tsx");
  const route = await source("src/app/api/seo-title-ledger/sync/route.ts");
  const sync = await source("src/lib/seoTitleBulkInventorySync.ts");
  assert.match(bridge, /\/api\/seo-title-ledger\/sync/);
  assert.match(bridge, /commerceOs\.seoBulkCloud\.batch\.v1/);
  assert.match(route, /syncSeoTitleBulkInventoryForItem/);
  assert.match(route, /mapLimit\(itemIds, 2/);
  assert.match(sync, /upsertSeoTitleLedger/);
  assert.match(sync, /seo_title_inventory/);
  assert.match(sync, /generateSeoTitleInventory/);
  assert.match(sync, /seo-bulk-cloud-inventory-v2/);
  assert.match(sync, /status: fullGoodsKeys \? "used" : "review"/);
  assert.match(sync, /existingTitleFingerprints/);
  assert.match(sync, /existingSemanticFingerprints/);
});

test("상품명 재고는 상품별 launch ledger를 재사용해 같은 FINAL을 다시 열어도 중복 원장을 만들지 않는다", async () => {
  const sync = await source("src/lib/seoTitleBulkInventorySync.ts");
  assert.match(sync, /ledgerKey = `launch:\$\{normalizedId\}`/);
  assert.match(sync, /findSeoTitleLedgerByKey/);
  assert.match(sync, /on_conflict=ledger_id,title_fingerprint/);
  assert.match(sync, /resolution=merge-duplicates/);
});
