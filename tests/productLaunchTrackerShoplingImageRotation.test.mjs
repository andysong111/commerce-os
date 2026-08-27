import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductLaunchShoplingPayload,
} from "../src/lib/productLaunchTrackerShopling.ts";

function readyItem(history = []) {
  return {
    id: "launch-aaa500",
    modelNumber: "AAA500",
    productName: "테스트 상품",
    shoplingCategory: "생활>잡화",
    selfCodeBase: "PLTEST000001",
    detailPageAsset: {
      html: "<p>상세</p>",
      mainImageUrl: "https://example.com/image-1.jpg",
      additionalImageUrls: [
        "https://example.com/image-2.jpg",
        "https://example.com/image-3.jpg",
        "https://example.com/image-4.jpg",
        "https://example.com/image-5.jpg",
      ],
    },
    orderOptions: [
      {
        optionName: "구성",
        saleOption: "단품",
        barcode: "BAA500-1",
        optionBarcodeNo: "000000000501",
        baseSalePriceKrw: 10000,
        unitCostKrw: 5000,
      },
    ],
    shoplingRegistrationHistory: history,
  };
}

test("상품별 Shopling 이미지 순환 회차는 등록 이력 수를 그대로 따른다", () => {
  const first = buildProductLaunchShoplingPayload(
    readyItem(),
    {},
    "request-first",
  );
  const third = buildProductLaunchShoplingPayload(
    readyItem([{ status: "success" }, { status: "failed" }]),
    {},
    "request-third",
  );

  assert.deepEqual(first.imageRotation, {
    strategy: "round_robin_v1",
    round: 0,
    source: "shopling_registration_history",
  });
  assert.deepEqual(third.imageRotation, {
    strategy: "round_robin_v1",
    round: 2,
    source: "shopling_registration_history",
  });
  assert.deepEqual(first.images, third.images);
});
