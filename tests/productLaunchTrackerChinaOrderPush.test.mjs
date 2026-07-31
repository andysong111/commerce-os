import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("비공개 China Order Manager는 Ops Center 푸시 캐시로 연동한다", async () => {
  const pushRoute = await readFile(
    new URL(
      "../src/app/api/product-launch-tracker/china-order-options/push/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const readRoute = await readFile(
    new URL(
      "../src/app/api/product-launch-tracker/china-order-options/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(pushRoute, /x-commerce-os-integration-secret/);
  assert.match(pushRoute, /chinaOrderOptionsCache/);
  assert.match(pushRoute, /writeProductLaunchState/);
  assert.match(pushRoute, /China Order Manager 서버 푸시 동기화/);
  assert.match(readRoute, /readCachedSnapshot/);
  assert.match(readRoute, /ops_center_cache/);
  assert.match(readRoute, /비공개 China Order Manager Site/);
});
