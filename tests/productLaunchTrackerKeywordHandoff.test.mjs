import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildProductLaunchFlowHandoff,
  hasCompleteShoplingRegistration,
} from "../public/product-launch-tracker-app/lib/product-launch-flow-handoff.mjs";
import {
  isSuccessfulSimpleUploadResult,
  parseProductLaunchSimpleSession,
} from "../src/lib/productLaunchSimpleSession.ts";

const registeredItem = {
  id: "launch-aaa492",
  modelNumber: "AAA492",
  productName: "미니짐볼 300g 색상랜덤",
  selfCodeBase: "PLTRJR88WTD8",
  stages: {
    priceKeyword: { status: "미시작" },
  },
  shoplingProducts: {
    wholesale1: { goodsKey: "121455", status: "success" },
    wholesale2: { goodsKey: "121456", status: "success" },
    wholesale3: { goodsKey: "121457", status: "success" },
    wholesale4: { goodsKey: "121458", status: "success" },
    retail1: { goodsKey: "121459", status: "success" },
    retail2: { goodsKey: "121460", status: "success" },
  },
};

test("등록완료 6채널을 상품출시플로우 성공 세션으로 변환한다", () => {
  assert.equal(hasCompleteShoplingRegistration(registeredItem), true);
  const handoff = buildProductLaunchFlowHandoff(
    registeredItem,
    new Date("2026-08-01T03:30:00+09:00"),
  );
  const session = parseProductLaunchSimpleSession(handoff.session);
  assert.ok(session);
  assert.equal(isSuccessfulSimpleUploadResult(session.uploadResult), true);
  assert.equal(session.priceResult?.summary?.status, "success");
  assert.equal(session.priceResult?.summary?.price_preserved, true);
  assert.equal(session.uploadResult?.summary?.goods_key_count, 6);
  assert.deepEqual(session.uploadResult?.goodsKeys, [
    "121455",
    "121456",
    "121457",
    "121458",
    "121459",
    "121460",
  ]);
  assert.equal(session.titles["121455"], "미니짐볼 300g 색상랜덤 도매1");
  assert.equal(session.titles["121460"], "미니짐볼 300g 색상랜덤 소매2");
  assert.equal(handoff.handoff.itemId, "launch-aaa492");
});

test("부분 등록 상품은 키워드 단계로 넘기지 않는다", () => {
  const partial = structuredClone(registeredItem);
  partial.shoplingProducts.retail2.goodsKey = "";
  assert.equal(hasCompleteShoplingRegistration(partial), false);
  assert.throws(
    () => buildProductLaunchFlowHandoff(partial),
    /6채널 등록완료/,
  );
});

test("진행관리 UI와 완료 콜백을 연결한다", async () => {
  const handoffUi = await readFile(
    new URL(
      "../public/product-launch-tracker-app/product-launch-flow-handoff.js",
      import.meta.url,
    ),
    "utf8",
  );
  const app = await readFile(
    new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
    "utf8",
  );
  const syncComponent = await readFile(
    new URL(
      "../src/components/product-launch-flow/ProductLaunchTrackerHandoffSync.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(app, /product-launch-flow-handoff\.js/);
  assert.match(handoffUi, /상품명·키워드 이어가기/);
  assert.match(handoffUi, /tracker-price-preserved/);
  assert.match(handoffUi, /status: "진행 중"/);
  assert.match(syncComponent, /price_repair_required === false/);
  assert.match(syncComponent, /status: "완료"/);
  assert.match(syncComponent, /기존 가격은 유지되었습니다/);
});
