import assert from "node:assert/strict";
import test from "node:test";

import {
  generateShoplingRetrySelfCode,
  needsShoplingSelfCodeRotation,
  rotateShoplingSelfCodeForRetry,
} from "../src/lib/productLaunchShoplingRetry.ts";

const duplicateProducts = () => ({
  wholesale1: { status: "failed", goodsKey: "", error: "1 번째 줄 상품 자사상품코드 중복" },
  wholesale2: { status: "failed", goodsKey: "", error: "1 번째 줄 상품 자사상품코드 중복" },
  wholesale3: { status: "failed", goodsKey: "", error: "1 번째 줄 상품 자사상품코드 중복" },
  wholesale4: { status: "failed", goodsKey: "", error: "1 번째 줄 상품 자사상품코드 중복" },
  retail1: { status: "failed", goodsKey: "", error: "1 번째 줄 상품 자사상품코드 중복" },
  retail2: { status: "failed", goodsKey: "", error: "1 번째 줄 상품 자사상품코드 중복" },
});

test("6채널이 모두 자사상품코드 중복 실패이고 goods_key가 없을 때만 새 코드 재발급 대상이다", () => {
  assert.equal(
    needsShoplingSelfCodeRotation({ shoplingProducts: duplicateProducts() }),
    true,
  );

  const withGoodsKey = duplicateProducts();
  withGoodsKey.retail1.goodsKey = "123456";
  assert.equal(
    needsShoplingSelfCodeRotation({ shoplingProducts: withGoodsKey }),
    false,
  );

  const otherFailure = duplicateProducts();
  otherFailure.retail2.error = "옵션 형식 오류";
  assert.equal(
    needsShoplingSelfCodeRotation({ shoplingProducts: otherFailure }),
    false,
  );
});

test("재등록용 자사상품코드는 기존 코드 집합과 겹치지 않는 PL 코드로 생성한다", () => {
  const candidates = ["OLD0000001", "NEW0000002"];
  const generated = generateShoplingRetrySelfCode(
    ["PLOLD0000001", "PLNEW0000002"],
    () => candidates.shift() ?? "LAST000003",
  );
  assert.equal(generated, "PLLAST000003");
  assert.match(generated, /^PL[A-Z0-9]{8,}$/);
});

test("코드 교체는 이전 코드를 감사 메타데이터로 보존하고 상품의 현재 코드만 새 값으로 바꾼다", () => {
  const rotated = rotateShoplingSelfCodeForRetry({
    item: {
      id: "launch-test",
      selfCodeBase: "PLOLDSELF01",
      shoplingProducts: duplicateProducts(),
      productName: "테스트상품",
    },
    allItems: [
      { selfCodeBase: "PLOLDSELF01" },
      { selfCodeBase: "PLUSED00002" },
    ],
    now: "2026-08-25T12:00:00.000Z",
    randomFactory: () => "FRESH00003",
  });

  assert.equal(rotated.previousSelfCodeBase, "PLOLDSELF01");
  assert.equal(rotated.selfCodeBase, "PLFRESH00003");
  assert.equal(rotated.item.selfCodeBase, "PLFRESH00003");
  assert.deepEqual(rotated.item.shoplingSelfCodeRetry, {
    previousSelfCodeBase: "PLOLDSELF01",
    selfCodeBase: "PLFRESH00003",
    reason: "SHOPLING_SELF_CODE_DUPLICATE",
    rotatedAt: "2026-08-25T12:00:00.000Z",
  });
  assert.equal(rotated.item.productName, "테스트상품");
});
