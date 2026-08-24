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
        optionBarcodeNo: "000000000101",
        baseSalePriceKrw: 1000,
        unitCostKrw: 500,
      },
    ],
    ...overrides,
  };
}

test("단일 옵션은 B코드를 옵션자체관리코드로 쓰고 숫자 옵션바코드NO는 별도 유지한다", () => {
  const payload = buildProductLaunchShoplingPayload(
    baseItem(),
    policy,
    "request-single",
  );
  assert.equal(payload.channels.length, 6);
  assert.ok(
    payload.channels.every(
      (channel) =>
        channel.options.length === 1 &&
        channel.options[0].barcode === "BAA1-1" &&
        channel.options[0].optionBarcodeNo === "000000000101",
    ),
  );
});

test("옵션이 여러 개면 각 B코드와 숫자 옵션바코드NO를 독립적으로 유지한다", () => {
  const payload = buildProductLaunchShoplingPayload(
    baseItem({
      barcode: "MAIN-DO-NOT-OVERRIDE",
      orderOptions: [
        {
          optionName: "색상",
          saleOption: "화이트",
          barcode: "BAA1-1",
          optionBarcodeNo: "000000000101",
          baseSalePriceKrw: 1000,
          unitCostKrw: 500,
        },
        {
          optionName: "색상",
          saleOption: "블랙",
          barcode: "BAA1-2",
          optionBarcodeNo: "000000000102",
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
  assert.deepEqual(
    payload.channels[0].options.map((option) => option.optionBarcodeNo),
    ["000000000101", "000000000102"],
  );
});

test("옵션바코드NO는 임의 영문 형식을 허용하지 않는다", () => {
  const broken = baseItem();
  broken.orderOptions[0].optionBarcodeNo = "ABC000000101";
  assert.throws(
    () => buildProductLaunchShoplingPayload(broken, policy, "request-alpha-no"),
    /숫자 12자리/,
  );
});

test("전환기 OB prefix 입력은 임시 호환되지만 신규 원장은 숫자만 사용한다", () => {
  const legacy = baseItem();
  legacy.orderOptions[0].optionBarcodeNo = "OB000000000101";
  const payload = buildProductLaunchShoplingPayload(legacy, policy, "request-legacy-prefix");
  assert.equal(payload.channels[0].options[0].optionBarcodeNo, "OB000000000101");
});

test("옵션바코드NO가 없으면 Shopling 등록 payload를 차단한다", () => {
  const broken = baseItem();
  broken.orderOptions[0].optionBarcodeNo = "";
  assert.throws(
    () => buildProductLaunchShoplingPayload(broken, policy, "request-missing-no"),
    /옵션바코드NO/,
  );
});

test("브라우저 저장 데이터의 단일 옵션 B코드 동기화는 그대로 유지한다", () => {
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
