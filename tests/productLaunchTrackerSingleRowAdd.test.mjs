import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildSingleRowOrderOptions,
  buildSingleRowTrackerState,
  nextTrackerRowNumber,
  parseSingleRowList,
} from "../public/product-launch-tracker-app/single-row-add.js";
import { syncAddedSingleRowBarcode } from "../public/product-launch-tracker-app/single-row-add-barcode-guard.js";

const appSource = await readFile(
  new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
  "utf8",
);
const optimizedSource = await readFile(
  new URL(
    "../public/product-launch-tracker-app/optimized-app.js",
    import.meta.url,
  ),
  "utf8",
);

test("상품 추가 버튼과 단건·다건 생성이 최적화 진행관리 앱에 연결된다", () => {
  assert.match(appSource, /optimized-app\.js/);
  assert.doesNotMatch(appSource, /single-row-add\.js/);
  assert.match(optimizedSource, /#add-items-button/);
  assert.match(optimizedSource, /operation: "create_items"/);
  assert.match(optimizedSource, /items: \[changed\]/);
  assert.match(optimizedSource, /items: parsed/);
});

test("옵션 입력은 쉼표와 줄바꿈을 지원한다", () => {
  assert.deepEqual(parseSingleRowList("화이트, 블랙\n핑크"), [
    "화이트",
    "블랙",
    "핑크",
  ]);
});

test("단일 옵션은 기준바코드를 옵션 바코드에 동일하게 사용한다", () => {
  const result = buildSingleRowOrderOptions({
    barcode: "baa1-1",
    optionName: "구성",
    options: "단품",
    optionBarcodes: "",
  });
  assert.equal(result.barcode, "BAA1-1");
  assert.equal(result.orderOptions.length, 1);
  assert.equal(result.orderOptions[0].barcode, "BAA1-1");
  assert.equal(result.orderOptions[0].optionName, "구성");
});

test("단일 옵션에 서로 다른 값이 들어와도 기준바코드를 우선해 동일하게 맞춘다", () => {
  const state = {
    schemaVersion: 3,
    items: [
      {
        id: "new-row",
        barcode: "BAA1-1",
        orderOptions: [{ saleOption: "단품", barcode: "BAA1-2" }],
      },
    ],
  };
  const result = syncAddedSingleRowBarcode(
    state,
    "new-row",
    "2026-08-05T14:40:00.000Z",
  );
  assert.equal(result.changed, true);
  assert.equal(result.state.items[0].barcode, "BAA1-1");
  assert.equal(result.state.items[0].orderOptions[0].barcode, "BAA1-1");
});

test("다중 옵션은 각 옵션별 위치코드를 순서대로 보존한다", () => {
  const result = buildSingleRowOrderOptions({
    barcode: "",
    options: "화이트,블랙,핑크",
    optionBarcodes: "BAA1-1,BAA1-2,BAA1-3",
  });
  assert.equal(result.barcode, "");
  assert.deepEqual(
    result.orderOptions.map((option) => option.barcode),
    ["BAA1-1", "BAA1-2", "BAA1-3"],
  );
});

test("새 상품은 다음 고정 행번호로 추가되고 기존 삭제 보호값을 보존한다", () => {
  const state = {
    schemaVersion: 3,
    serverDeletedItemIds: ["deleted-1"],
    policy: { version: 1 },
    items: [
      {
        id: "existing-1",
        trackerRowNumber: 2478,
        modelNumber: "AAA451",
        selfCodeBase: "PLAAAA1111",
      },
      {
        id: "existing-2",
        source: { rows: [2500] },
        modelNumber: "AAA452",
        selfCodeBase: "PLBBBB2222",
      },
    ],
  };
  assert.equal(nextTrackerRowNumber(state.items), 2501);

  const result = buildSingleRowTrackerState(
    state,
    {
      workBatch: "2026 8월 1주차",
      barcode: "BCD1-1",
      modelNumber: "aaa500",
      productName: "새 상품",
      shoplingCategory: "생활/수납",
      optionName: "색상",
      options: "색상랜덤 발송",
      optionBarcodes: "",
      notes: "신규 입고",
    },
    "2026-08-05T14:30:00.000Z",
    {
      idFactory: () => "new-item-1",
      codeFactory: () => "PLNEWCODE01",
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.item.id, "new-item-1");
  assert.equal(result.item.trackerRowNumber, 2501);
  assert.equal(result.item.modelNumber, "AAA500");
  assert.equal(result.item.barcode, "BCD1-1");
  assert.equal(result.item.orderOptions[0].barcode, "BCD1-1");
  assert.deepEqual(result.state.serverDeletedItemIds, ["deleted-1"]);
  assert.equal(result.state.items.length, 3);
});

test("이미 존재하는 모델번호는 중복 추가하지 않는다", () => {
  const result = buildSingleRowTrackerState(
    {
      schemaVersion: 3,
      items: [{ id: "existing", modelNumber: "AAA500" }],
    },
    {
      modelNumber: "aaa0500",
      productName: "중복 상품",
      options: "단품",
    },
    "2026-08-05T14:30:00.000Z",
    {
      idFactory: () => "duplicate",
      codeFactory: () => "PLDUPLICATE",
    },
  );
  assert.equal(result.ok, false);
  assert.match(result.message, /이미 존재/);
});
