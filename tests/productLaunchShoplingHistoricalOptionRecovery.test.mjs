import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildProductLaunchShoplingPayload } from "../src/lib/productLaunchTrackerShopling.ts";
import { recoverProductLaunchOrderOptionsFromPayload } from "../src/lib/productLaunchShoplingHistoricalOptionRecovery.ts";

const policy = {
  channelMultipliers: {
    wholesale1: 1.1,
    wholesale2: 1.15,
    wholesale3: 1,
    wholesale4: 1.3,
    retail1: 1.3,
    retail2: 1.4,
  },
  listPriceMultiplier: 1.5,
};

const priorPayload = {
  channels: [
    {
      key: "wholesale1",
      options: [
        {
          optionName: "옵션",
          saleOption: "블랙",
          barcode: "BGE1-1",
          optionBarcodeNo: "000000000285",
          finalSalePriceKrw: 7270,
        },
      ],
    },
    {
      key: "wholesale3",
      options: [
        {
          optionName: "옵션",
          saleOption: "블랙",
          barcode: "BGE1-1",
          optionBarcodeNo: "000000000285",
          finalSalePriceKrw: 6600,
        },
      ],
    },
  ],
};

test("과거 성공 payload는 multiplier=1 채널에서 기준판매가와 정확한 옵션 식별자만 복구한다", () => {
  const recovered = recoverProductLaunchOrderOptionsFromPayload(priorPayload, policy);
  assert.ok(recovered);
  assert.equal(recovered.baseChannelKey, "wholesale3");
  assert.deepEqual(recovered.options, [
    {
      id: "shopling-history-1-BGE1-1",
      optionName: "옵션",
      saleOption: "블랙",
      chinaOption: "",
      barcode: "BGE1-1",
      optionBarcodeNo: "000000000285",
      baseSalePriceKrw: 6600,
      unitCostKrw: 0,
      sourceOrderItemId: null,
    },
  ]);
});

test("판매가에서 원가를 만들어내지 않아도 Shopling payload는 생성된다", () => {
  const recovered = recoverProductLaunchOrderOptionsFromPayload(priorPayload, policy);
  assert.ok(recovered);
  const payload = buildProductLaunchShoplingPayload(
    {
      id: "launch-test",
      modelNumber: "AAA045",
      productName: "그늘막 썬캡",
      shoplingCategory: "패션>모자",
      selfCodeBase: "PLRECOVERY01",
      barcode: "BGE1-1",
      orderOptions: recovered.options,
      detailPageAsset: {
        html: "<p>상세</p>",
        mainImageUrl: "https://example.com/main.jpg",
        additionalImageUrls: [],
      },
    },
    policy,
    "recovery-test",
  );
  const wholesale3 = payload.channels.find((channel) => channel.key === "wholesale3");
  assert.equal(wholesale3?.salePrice, 6600);
  assert.equal(wholesale3?.options[0]?.optionBarcodeNo, "000000000285");
});

test("multiplier=1 가격증거가 없으면 과거 판매가를 역산하지 않고 복구를 거부한다", () => {
  assert.equal(
    recoverProductLaunchOrderOptionsFromPayload(priorPayload, {
      channelMultipliers: { wholesale1: 1.1, wholesale3: 1.2 },
    }),
    null,
  );
});

test("업로드 route는 durable RUN에서만 exact launch_item_id 성공 이력을 사용한다", async () => {
  const route = await readFile(
    new URL("../src/app/api/product-launch-tracker/shopling-upload/route.ts", import.meta.url),
    "utf8",
  );
  const recovery = await readFile(
    new URL("../src/lib/productLaunchShoplingHistoricalOptionRecovery.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /durableSeoRunPrepared/);
  assert.match(route, /recoverProductLaunchOrderOptionsFromSuccessfulUpload/);
  assert.match(recovery, /launch_item_id: `eq\.\$\{itemId\}`/);
  assert.match(recovery, /status: "eq\.success"/);
  assert.doesNotMatch(recovery, /model_number:|modelNumber:/);
  assert.match(route, /PRODUCT_LAUNCH_ORDER_OPTIONS_REQUIRED/);
});
