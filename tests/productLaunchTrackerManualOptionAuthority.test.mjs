import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyProductLaunchTrackerMutation } from "../src/lib/productLaunchTrackerOptimized.ts";

const [guard, optimizedApp] = await Promise.all([
  readFile("public/product-launch-tracker-app/model-bcode-option-guard.js", "utf8"),
  readFile("public/product-launch-tracker-app/optimized-app.js", "utf8"),
]);

test("상세 진입은 모델번호 전체 B-code를 자동으로 다시 가져오지 않는다", () => {
  assert.doesNotMatch(guard, /MODEL_OPTIONS_API/);
  assert.doesNotMatch(guard, /model-order-options\?/);
  assert.match(guard, /const savedOptions = Array\.isArray\(item\.orderOptions\)/);
  assert.match(guard, /const nextOptions = savedOptions/);
  assert.match(guard, /모델번호 전체 B-code를 자동 추가·복원하지 않습니다/);
});

test("옵션바코드NO 자동발급은 저장된 옵션 목록 자체를 바꾸지 않는다", () => {
  assert.match(guard, /if \(missingOptionBarcodeNo\)/);
  assert.match(guard, /patch: \{ orderOptions: nextOptions \}/);
  assert.doesNotMatch(guard, /if \(changed \|\| missingOptionBarcodeNo\)/);
});

test("발주·입고 데이터는 사용자가 불러오기 버튼을 눌렀을 때만 옵션 초안을 교체한다", () => {
  assert.match(optimizedApp, /#china-sync-button/);
  assert.match(optimizedApp, /\/api\/product-launch-tracker\/china-order-options\?/);
  assert.match(optimizedApp, /state\.detailDraftOptions = normalizeOrderOptions\(body\.options\)/);
});

test("상품상세에서 옵션 두 개를 삭제해 저장하면 서버 mutation도 두 개만 유지한다", () => {
  const state = {
    schemaVersion: 3,
    items: [
      {
        id: "launch-2442-aaa465",
        modelNumber: "AAA465",
        productName: "쿨수건 원형파우치포함",
        orderOptions: [
          { id: "1", optionName: "옵션", saleOption: "블루", barcode: "BEE2-1" },
          { id: "2", optionName: "옵션", saleOption: "핑크", barcode: "BEE2-2" },
          { id: "3", optionName: "옵션", saleOption: "블루", barcode: "BEE2-3" },
          { id: "4", optionName: "옵션", saleOption: "핑크", barcode: "BEE3-1" },
        ],
        stages: {},
      },
    ],
  };
  const mutation = applyProductLaunchTrackerMutation(state, {
    operation: "patch_item",
    itemId: "launch-2442-aaa465",
    patch: {
      orderOptions: [
        { id: "1", optionName: "옵션", saleOption: "블루", barcode: "BEE2-1" },
        { id: "2", optionName: "옵션", saleOption: "핑크", barcode: "BEE2-2" },
      ],
    },
  });
  assert.deepEqual(
    mutation.state.items[0].orderOptions.map((option) => option.barcode),
    ["BEE2-1", "BEE2-2"],
  );
});
