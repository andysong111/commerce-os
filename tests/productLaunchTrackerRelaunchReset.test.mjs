import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canResetForRelaunch,
  resetLaunchItemForRelaunch,
} from "../public/product-launch-tracker-app/lib/relaunch-reset.mjs";
import {
  SHOPLING_CHANNELS,
  STAGES,
} from "../public/product-launch-tracker-app/lib/tracker-core.mjs";

function registeredItem() {
  return {
    id: "item-aaa492",
    modelNumber: "AAA492",
    productName: "미니짐볼 300g 색상랜덤",
    barcode: "BFF1-1",
    shoplingCategory: "스포츠>헬스",
    selfCodeBase: "PLOLD000001",
    orderOptions: [
      {
        id: "option-1",
        optionName: "옵션",
        saleOption: "단품",
        barcode: "BFF1-1",
        baseSalePriceKrw: 8738,
        unitCostKrw: 4369,
      },
    ],
    detailPageAsset: {
      html: "<p>상세페이지</p>",
      mainImageUrl: "https://example.com/main.jpg",
      additionalImageUrls: ["https://example.com/1.jpg"],
    },
    shoplingProducts: Object.fromEntries(
      SHOPLING_CHANNELS.map((channel, index) => [
        channel.key,
        {
          goodsKey: String(121455 + index),
          status: "success",
          error: "",
          registeredAt: "2026-08-01T01:57:00.000Z",
        },
      ]),
    ),
    stages: Object.fromEntries(
      STAGES.map((stage) => [
        stage.key,
        {
          status: "완료",
          completedAt: "2026-08-01T02:00:00.000Z",
          note: "완료 기록",
          assignee: "승준",
        },
      ]),
    ),
    updatedAt: "2026-08-01T02:00:00.000Z",
    updatedBy: "상품출시플로우",
  };
}

test("등록완료 상품을 재출시 초기화하면 원본 데이터는 유지하고 실행 결과만 초기화한다", () => {
  const item = registeredItem();
  const values = ["BBBBBBBBBB", "CCCCCCCCCC"];
  const reset = resetLaunchItemForRelaunch(
    item,
    [item, { id: "other", selfCodeBase: "PLBBBBBBBBBB" }],
    {
      now: new Date("2026-08-01T06:00:00.000Z"),
      randomFactory: () => values.shift() ?? "DDDDDDDDDD",
    },
  );

  assert.equal(reset.selfCodeBase, "PLCCCCCCCCCC");
  assert.equal(reset.goodsKey, "");
  assert.deepEqual(reset.orderOptions, item.orderOptions);
  assert.deepEqual(reset.detailPageAsset, item.detailPageAsset);
  assert.equal(reset.shoplingCategory, item.shoplingCategory);
  assert.equal(reset.barcode, item.barcode);
  assert.ok(
    SHOPLING_CHANNELS.every((channel) => {
      const product = reset.shoplingProducts[channel.key];
      return (
        product.goodsKey === "" &&
        product.status === "not_started" &&
        product.registeredAt === null
      );
    }),
  );
  assert.ok(
    STAGES.every((stage) => {
      const state = reset.stages[stage.key];
      return (
        state.status === "미시작" &&
        state.completedAt === null &&
        state.note === "" &&
        state.assignee === "승준"
      );
    }),
  );
  assert.equal(reset.registrationResetHistory.length, 1);
  assert.equal(
    reset.registrationResetHistory[0].previousProducts.wholesale1.goodsKey,
    "121455",
  );
  assert.equal(
    reset.registrationResetHistory[0].previousProducts.retail2.goodsKey,
    "121460",
  );
  assert.equal(canResetForRelaunch(reset), false);
});

test("등록 결과가 없는 상품은 재출시 초기화하지 않는다", () => {
  const item = registeredItem();
  item.shoplingProducts = {};
  assert.equal(canResetForRelaunch(item), false);
  assert.throws(
    () => resetLaunchItemForRelaunch(item, [item]),
    /등록된 goods_key/,
  );
});

test("재출시 UI는 모델번호 확인·서버 저장·이전 흐름 정리를 포함한다", async () => {
  const source = await readFile(
    new URL(
      "../public/product-launch-tracker-app/relaunch-reset.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /재출시 초기화/);
  assert.match(source, /계속하려면 모델번호/);
  assert.match(source, /TRACKER_STATE_ENDPOINT/);
  assert.match(source, /PRODUCT_LAUNCH_TRACKER_HANDOFF_KEY/);
  assert.match(source, /PRODUCT_LAUNCH_SIMPLE_SESSION_KEY/);
  assert.match(source, /registrationResetHistory/);
});
