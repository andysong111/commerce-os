import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyChinaProductLinks,
  MAX_CHINA_PRODUCT_LINKS,
  normalizeChinaProductLinks,
  promoteChinaProductLink,
  readChinaProductLinks,
  sameChinaProductLinks,
} from "../public/product-launch-tracker-app/lib/china-product-links.mjs";

test("중국 상품링크는 최대 5개로 정규화하고 중복을 제거한다", () => {
  const links = normalizeChinaProductLinks([
    "detail.1688.com/offer/1.html",
    "https://detail.1688.com/offer/1.html",
    "https://detail.1688.com/offer/2.html",
    "https://detail.1688.com/offer/3.html",
    "https://detail.1688.com/offer/4.html",
    "https://detail.1688.com/offer/5.html",
    "https://detail.1688.com/offer/6.html",
  ]);
  assert.equal(MAX_CHINA_PRODUCT_LINKS, 5);
  assert.equal(links.length, 5);
  assert.equal(links[0], "https://detail.1688.com/offer/1.html");
  assert.equal(links[4], "https://detail.1688.com/offer/5.html");
});

test("선택한 링크를 상세페이지 엔진용 1번으로 고정한다", () => {
  const pinned = promoteChinaProductLink(
    [
      "https://detail.1688.com/offer/1.html",
      "https://detail.1688.com/offer/2.html",
      "https://detail.1688.com/offer/3.html",
      "",
      "",
    ],
    2,
  );
  assert.equal(pinned[0], "https://detail.1688.com/offer/3.html");
  assert.equal(pinned[1], "https://detail.1688.com/offer/1.html");
  assert.equal(pinned[2], "https://detail.1688.com/offer/2.html");
  assert.equal(pinned.length, 5);
});

test("1번 링크를 상세페이지 엔진 대표 필드로 함께 저장한다", () => {
  const item = applyChinaProductLinks(
    { id: "item-1", modelNumber: "AAA492", detailPageSource: { resultId: "old" } },
    [
      "https://detail.1688.com/offer/primary.html",
      "https://detail.1688.com/offer/secondary.html",
    ],
    { now: new Date("2026-08-01T00:00:00.000Z") },
  );
  assert.equal(
    item.primaryChinaProductLink,
    "https://detail.1688.com/offer/primary.html",
  );
  assert.deepEqual(item.chinaProductLinks, [
    "https://detail.1688.com/offer/primary.html",
    "https://detail.1688.com/offer/secondary.html",
  ]);
  assert.equal(
    item.detailPageSource.primaryUrl,
    "https://detail.1688.com/offer/primary.html",
  );
  assert.deepEqual(item.detailPageSource.urls, item.chinaProductLinks);
  assert.equal(item.detailPageSource.pinnedIndex, 0);
  assert.equal(item.detailPageSource.resultId, "old");
  assert.equal(sameChinaProductLinks(item, item.chinaProductLinks), true);
  assert.deepEqual(readChinaProductLinks(item), item.chinaProductLinks);
});

test("중국 링크 UI는 5칸·1번 고정·서버 저장·상세 재열기를 지원한다", async () => {
  const ui = await readFile(
    new URL(
      "../public/product-launch-tracker-app/china-product-links.js",
      import.meta.url,
    ),
    "utf8",
  );
  const app = await readFile(
    new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
    "utf8",
  );
  assert.match(ui, /MAX_CHINA_PRODUCT_LINKS/);
  assert.match(ui, /1번으로 고정/);
  assert.match(ui, /상세페이지 엔진용 1번/);
  assert.match(ui, /TRACKER_STATE_ENDPOINT/);
  assert.match(ui, /REOPEN_ITEM_KEY/);
  assert.doesNotMatch(ui, /MutationObserver/);
  assert.match(app, /china-product-links\.js/);
});
