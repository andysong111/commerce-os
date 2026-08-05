import assert from "node:assert/strict";
import test from "node:test";
import { buildProductLaunchShoplingPayload } from "../src/lib/productLaunchTrackerShopling.ts";
import { syncSingleOptionBarcodes } from "../public/product-launch-tracker-app/single-option-barcode-sync.js";

const policy = {
  channelMultipliers: {
    wholesale1: 1,
    wholesale2: 1.15,
    wholesale3: 1.1,
    wholesale4: 1.3,
    retail1: 1.3,
    retail2: 1.4,
  },
};

function baseItem(overrides = {}) {
  return {
    id: "launch-1",
    modelNumber: "AAA500",
    productName: "테스트 상품",
    shoplingCategory: "생활/수납",
    selfCodeBase: "PLTEST1234",
    barcode: "BAA1-1",
    detailPageAsset: {
      html: "<p>상세</p>",
      mainImageUrl: "https://example.com/main.jpg",
      additionalImageUrls: [],
    },
    orderOptions: [
      {
        optionName: "옵션",
        saleOption: "단품",
        barcode: "",
        baseSalePriceKrw: 1000,
        unitCostKrw: 500,
      },
    ],
    ...overrides,
  };
}

test("옵션이 하나면 기준바코드를 바코드·옵션자체관리코드용 옵션 코드로 사용한다", () => {
  const payload = buildProductLaunchShoplingPayload(
    baseItem(),
    policy,
    "request-single",
  );
  assert.equal(payload.channels.length, 6);
  assert.ok(
    payload.channels.every(
      (channel) => channel.options.length === 1 && channel.options[0].barcode === "BAA1-1",
    ),
  );
});

test("옵션이 여러 개면 각 옵션별 위치코드를 유지하고 기준바코드로 덮어쓰지 않는다", () => {
  const payload = buildProductLaunchShoplingPayload(
    baseItem({
      barcode: "MAIN-DO-NOT-OVERRIDE",
      orderOptions: [
        {
          optionName: "색상",
          saleOption: "화이트",
          barcode: "BAA1-1",
          baseSalePriceKrw: 1000,
          unitCostKrw: 500,
        },
        {
          optionName: "색상",
          saleOption: "블랙",
          barcode: "BAA1-2",
          baseSalePriceKrw: 1200,
          unitCostKrw: 600,
        },
      ],
    }),
    policy,
    "request-multi",
  );
  assert.deepEqual(
    payload.channels[0].options.map((option) => option.barcode),
    ["BAA1-1", "BAA1-2"],
  );
});

test("브라우저 저장 데이터도 단일 옵션의 기준바코드와 옵션 바코드를 동일하게 보정한다", () => {
  const result = syncSingleOptionBarcodes({
    items: [
      {
        id: "single",
        barcode: "bcb7-1",
        orderOptions: [{ saleOption: "색상랜덤 발송", barcode: "" }],
      },
      {
        id: "multi",
        barcode: "base",
        orderOptions: [
          { saleOption: "화이트", barcode: "b1" },
          { saleOption: "블랙", barcode: "b2" },
        ],
      },
    ],
  });
  assert.equal(result.changed, true);
  assert.equal(result.value.items[0].barcode, "BCB7-1");
  assert.equal(result.value.items[0].orderOptions[0].barcode, "BCB7-1");
  assert.deepEqual(
    result.value.items[1].orderOptions.map((option) => option.barcode),
    ["b1", "b2"],
  );
});
