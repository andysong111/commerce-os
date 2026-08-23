import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductLaunchShoplingPayload,
  resolveProductLaunchCommonPurchasePriceKrw,
  roundUpShoplingPriceKrw,
  SHOPLING_PRICE_ROUND_UP_UNIT_KRW,
} from "../src/lib/productLaunchTrackerShopling.ts";

function item() {
  return {
    id: "launch-rounding-test",
    modelNumber: "AAA999",
    productName: "가격 올림 테스트",
    shoplingCategory: "생활>잡화",
    selfCodeBase: "PLROUNDTEST",
    barcode: "BTEST-1",
    orderOptions: [
      {
        optionName: "옵션",
        saleOption: "단품",
        barcode: "BTEST-1",
        baseSalePriceKrw: 1050,
        unitCostKrw: 577,
      },
    ],
    detailPageAsset: {
      html: "<p>상세</p>",
      mainImageUrl: "https://example.com/main.jpg",
      additionalImageUrls: [],
    },
  };
}

test("샵플링 가격은 일의자리에서 올림해 10원 단위가 된다", () => {
  assert.equal(SHOPLING_PRICE_ROUND_UP_UNIT_KRW, 10);
  assert.equal(roundUpShoplingPriceKrw(1155), 1160);
  assert.equal(roundUpShoplingPriceKrw(1208), 1210);
  assert.equal(roundUpShoplingPriceKrw(577), 580);
  assert.equal(roundUpShoplingPriceKrw(1732.5), 1740);
  assert.equal(roundUpShoplingPriceKrw(1740), 1740);
});

test("상품출시 진행관리 원가를 기본 공통 원가로 한 번만 확정한다", () => {
  assert.equal(resolveProductLaunchCommonPurchasePriceKrw(item().orderOptions), 580);
  assert.equal(
    resolveProductLaunchCommonPurchasePriceKrw([
      { unitCostKrw: 577 },
      { unitCostKrw: 800 },
    ]),
    580,
  );
});

test("실제 상품등록 payload는 판매가가 달라도 6채널 원가는 공통값을 유지한다", () => {
  const payload = buildProductLaunchShoplingPayload(
    item(),
    {
      channelMultipliers: {
        wholesale1: 1.1,
        wholesale2: 1.15,
        wholesale3: 1,
        wholesale4: 1.3,
        retail1: 1.3,
        retail2: 1.4,
      },
      listPriceMultiplier: 1.5,
    },
    "rounding-test",
  );

  const wholesale1 = payload.channels.find((channel) => channel.key === "wholesale1");
  const wholesale2 = payload.channels.find((channel) => channel.key === "wholesale2");
  const retail2 = payload.channels.find((channel) => channel.key === "retail2");

  assert.equal(payload.commonPurchasePriceKrw, 580);
  assert.equal(wholesale1.salePrice, 1160);
  assert.equal(wholesale1.orgPrice, 580);
  assert.equal(wholesale1.listPrice, 1740);
  assert.equal(wholesale1.options[0].finalSalePriceKrw, 1160);
  assert.equal(wholesale1.options[0].additionalAmountKrw, 0);

  assert.equal(wholesale2.salePrice, 1210);
  assert.equal(wholesale2.orgPrice, 580);
  assert.equal(wholesale2.listPrice, 1820);

  assert.equal(retail2.salePrice, 1470);
  assert.equal(retail2.orgPrice, 580);
  assert.notEqual(retail2.orgPrice, retail2.salePrice / 2);

  assert.deepEqual(
    [...new Set(payload.channels.map((channel) => channel.orgPrice))],
    [580],
  );

  for (const channel of payload.channels) {
    assert.equal(channel.salePrice % 10, 0);
    assert.equal(channel.orgPrice % 10, 0);
    assert.equal(channel.listPrice % 10, 0);
    for (const option of channel.options) {
      assert.equal(option.finalSalePriceKrw % 10, 0);
      assert.equal(option.additionalAmountKrw % 10, 0);
    }
  }
});
