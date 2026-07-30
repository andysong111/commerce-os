import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildShoplingPreview,
  createLaunchItem,
  DEFAULT_POLICY,
  getShoplingReadiness,
} from "../public/product-launch-tracker-app/lib/tracker-core.mjs";

function aaa015Item(secondBarcode = "BAA1-2") {
  return createLaunchItem(
    {
      modelNumber: "AAA015",
      productName: "두구 골무",
      shoplingCategory: "생활>잡화",
      selfCodeBase: "PLM6YCRWM329",
      orderOptions: [
        {
          optionName: "옵션",
          saleOption: "두구 골무 S사이즈",
          barcode: "BAA1-1",
          baseSalePriceKrw: 10000,
          unitCostKrw: 5000,
        },
        {
          optionName: "옵션",
          saleOption: "두구 골무 M사이즈",
          barcode: secondBarcode,
          baseSalePriceKrw: 10000,
          unitCostKrw: 5000,
        },
      ],
      detailPageAsset: {
        html: "<p>상세페이지</p>",
        mainImageUrl: "https://example.com/main.jpg",
      },
    },
    () => "aaa015",
  );
}

test("AAA015 동일 옵션가격은 6채널 가격과 추가금 0원으로 계산한다", () => {
  const preview = buildShoplingPreview(aaa015Item(), DEFAULT_POLICY);
  assert.deepEqual(
    preview.channels.map(({ label, salePrice, listPrice }) => ({ label, salePrice, listPrice })),
    [
      { label: "도매1", salePrice: 11000, listPrice: 16500 },
      { label: "도매2", salePrice: 11500, listPrice: 17250 },
      { label: "도매3", salePrice: 10000, listPrice: 15000 },
      { label: "도매4", salePrice: 13000, listPrice: 19500 },
      { label: "소매1", salePrice: 13000, listPrice: 19500 },
      { label: "소매2", salePrice: 14000, listPrice: 21000 },
    ],
  );
  assert.ok(
    preview.channels.every((channel) =>
      channel.options.every((option) => option.additionalAmountKrw === 0),
    ),
  );
});

test("AAA015처럼 옵션 바코드가 중복되면 카나리 등록을 차단한다", () => {
  const readiness = getShoplingReadiness(aaa015Item("BAA1-1"));
  assert.equal(readiness.ready, false);
  assert.ok(readiness.errors.some((message) => message.includes("중복")));
});

test("상품 표는 상단 가로 스크롤과 본문 스크롤을 동기화한다", async () => {
  const app = await readFile(
    new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
    "utf8",
  );
  const module = await readFile(
    new URL("../public/product-launch-tracker-app/table-horizontal-scroll.js", import.meta.url),
    "utf8",
  );
  assert.match(app, /table-horizontal-scroll\.js/);
  assert.match(module, /tableWrap\.scrollLeft = scrollbar\.scrollLeft/);
  assert.match(module, /scrollbar\.scrollLeft = tableWrap\.scrollLeft/);
  assert.match(module, /ResizeObserver/);
  assert.match(module, /MutationObserver/);
});
