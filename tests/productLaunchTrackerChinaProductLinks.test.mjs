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
import {
  applyChinaOrderOptionMappings,
  readChinaOrderOptionMappings,
  sameChinaOrderOptionMappings,
} from "../public/product-launch-tracker-app/lib/china-order-options.mjs";

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
    {
      id: "item-1",
      modelNumber: "AAA492",
      detailPageSource: { resultId: "old" },
    },
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

test("각 B-code는 서로 다른 1688 링크와 중국옵션을 저장할 수 있다", () => {
  const links = [
    "https://detail.1688.com/offer/a.html",
    "https://detail.1688.com/offer/b.html",
  ];
  const base = applyChinaProductLinks(
    {
      id: "item-options",
      orderOptions: [
        { id: "o1", barcode: "BAC4-1", saleOption: "사이즈: A" },
        { id: "o2", barcode: "BAC4-2", saleOption: "사이즈: B" },
      ],
    },
    links,
  );
  const next = applyChinaOrderOptionMappings(
    base,
    [
      {
        id: "o1",
        barcode: "BAC4-1",
        saleOption: "사이즈: A",
        supplierLink: links[0],
        chinaOption: "中国规格A",
      },
      {
        id: "o2",
        barcode: "BAC4-2",
        saleOption: "사이즈: B",
        supplierLink: links[1],
        chinaOption: "中国规格B",
      },
    ],
    links,
  );
  const mappings = readChinaOrderOptionMappings(next);
  assert.deepEqual(
    mappings.map((row) => [row.barcode, row.saleOption, row.supplierLink, row.chinaOption]),
    [
      ["BAC4-1", "사이즈: A", links[0], "中国规格A"],
      ["BAC4-2", "사이즈: B", links[1], "中国规格B"],
    ],
  );
  assert.equal(sameChinaOrderOptionMappings(next, mappings, links), true);
});

test("B-code 주문링크는 상품상세에 저장된 중국 링크 중에서만 선택한다", () => {
  assert.throws(
    () =>
      applyChinaOrderOptionMappings(
        {
          orderOptions: [
            { id: "o1", barcode: "BAC4-1", saleOption: "A" },
          ],
        },
        [
          {
            id: "o1",
            barcode: "BAC4-1",
            saleOption: "A",
            supplierLink: "https://detail.1688.com/offer/not-saved.html",
            chinaOption: "红色",
          },
        ],
        ["https://detail.1688.com/offer/saved.html"],
      ),
    /중국 상품링크 목록에 없습니다/,
  );
});

test("중국 링크 UI는 5칸·1번 고정·B-code 주문매핑·서버 저장·상세 재열기를 지원한다", async () => {
  const legacyUi = await readFile(
    new URL(
      "../public/product-launch-tracker-app/china-product-links.js",
      import.meta.url,
    ),
    "utf8",
  );
  const activeUi = await readFile(
    new URL(
      "../public/product-launch-tracker-app/optimized-china-order-mapping.js",
      import.meta.url,
    ),
    "utf8",
  );
  const app = await readFile(
    new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
    "utf8",
  );
  assert.match(legacyUi, /MAX_CHINA_PRODUCT_LINKS/);
  assert.match(legacyUi, /1번으로 고정/);
  assert.match(legacyUi, /상세페이지 엔진용 1번/);
  assert.match(activeUi, /B-code별 중국 주문 매핑/);
  assert.match(activeUi, /data-optimized-china-order-link-select/);
  assert.match(activeUi, /data-optimized-china-order-option-input/);
  assert.match(activeUi, /applyChinaOrderOptionMappings/);
  assert.match(activeUi, /mode: "item"/);
  assert.match(activeUi, /operation: "patch_item"/);
  assert.doesNotMatch(activeUi, /MutationObserver/);
  assert.match(app, /optimized-china-order-mapping\.js/);
});

test("기본 상세 저장의 preventDefault 이후에도 중국 링크와 주문옵션을 저장하고 저장 버튼을 화면에 고정한다", async () => {
  const ui = await readFile(
    new URL(
      "../public/product-launch-tracker-app/china-product-links.js",
      import.meta.url,
    ),
    "utf8",
  );
  const activeUi = await readFile(
    new URL(
      "../public/product-launch-tracker-app/optimized-china-order-mapping.js",
      import.meta.url,
    ),
    "utf8",
  );
  const html = await readFile(
    new URL("../public/product-launch-tracker-app/index.html", import.meta.url),
    "utf8",
  );
  const styles = await readFile(
    new URL("../public/product-launch-tracker-app/styles.css", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    ui,
    /event\.defaultPrevented \|\| event\.submitter\?\.value !== "save"/,
  );
  assert.match(ui, /if \(detailDialog\?\.open\) return/);
  assert.match(ui, /sameChinaOrderOptionMappings/);
  assert.match(activeUi, /waitForMainSave/);
  assert.match(activeUi, /if \(detailDialog\?\.open\)/);
  assert.match(html, /class="button button-primary detail-floating-save" value="save"/);
  assert.match(styles, /\.detail-floating-save\s*\{[^}]*position: fixed/s);
});
