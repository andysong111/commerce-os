import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  reconcileModelOrderOptions,
  sameModelOrderOptions,
} from "../public/product-launch-tracker-app/lib/model-bcode-order-options.mjs";

const [route, guard, loader, page] = await Promise.all([
  readFile(
    "src/app/api/product-launch-tracker/model-order-options/route.ts",
    "utf8",
  ),
  readFile(
    "public/product-launch-tracker-app/model-bcode-option-guard.js",
    "utf8",
  ),
  readFile("public/product-launch-tracker-app/app.js", "utf8"),
  readFile("src/app/product-launch-tracker/page.tsx", "utf8"),
]);

test("모델의 실제 B-code만 남기고 빈 B-code와 다른 모델 B-code를 제거한다", () => {
  const current = [
    {
      id: "bad-empty-1",
      barcode: "",
      saleOption: "블랙1P,그레이1p",
      chinaOption: "잘못 연결된 옵션",
    },
    {
      id: "bad-empty-2",
      barcode: "",
      saleOption: "색상랜덤1P",
      chinaOption: "灰色",
    },
    {
      id: "bad-model-1",
      barcode: "BCB6-2",
      saleOption: "블랙1P",
      chinaOption: "110g短款斜纹-黑色格子手套",
    },
    {
      id: "bad-model-2",
      barcode: "BCB6-3",
      saleOption: "그레이1P",
      chinaOption: "110g短款斜纹-灰色格子手套",
    },
    {
      id: "valid",
      barcode: "BAC2-2",
      saleOption: "색상랜덤",
      chinaOption: "灰色",
      baseSalePriceKrw: 2200,
      unitCostKrw: 700,
    },
  ];
  const authority = [
    {
      barcode: "BAC2-2",
      saleOption: "색상랜덤",
      unitCostKrw: 650,
    },
  ];

  const next = reconcileModelOrderOptions(current, authority);
  assert.equal(next.length, 1);
  assert.equal(next[0].barcode, "BAC2-2");
  assert.equal(next[0].saleOption, "색상랜덤");
  assert.equal(next[0].chinaOption, "灰色");
  assert.equal(next[0].baseSalePriceKrw, 2200);
  assert.equal(next[0].unitCostKrw, 700);
  assert.equal(sameModelOrderOptions(current, next), false);
});

test("모델에 실제 존재하지만 저장되지 않은 B-code는 Product Master 옵션으로 보충한다", () => {
  const next = reconcileModelOrderOptions(
    [
      {
        id: "a",
        barcode: "BAC4-1",
        saleOption: "120cm",
        chinaOption: "中国规格A",
      },
    ],
    [
      { barcode: "BAC4-1", saleOption: "120cm", unitCostKrw: 1000 },
      { barcode: "BAC4-2", saleOption: "85cm", unitCostKrw: 800 },
    ],
  );
  assert.deepEqual(
    next.map((row) => [row.barcode, row.saleOption, row.chinaOption]),
    [
      ["BAC4-1", "120cm", "中国规格A"],
      ["BAC4-2", "85cm", ""],
    ],
  );
});

test("Product Master planning snapshot이 모델번호별 활성 B-code의 권위 원천이다", () => {
  assert.match(route, /loadProductPlanningSnapshot/);
  assert.match(route, /product\.skuActive === false/);
  assert.match(route, /normalizeModelNumber\(product\.modelNo\) !== modelNumber/);
  assert.match(route, /normalizeBarcode\(product\.barcode\)/);
  assert.match(route, /source: "product_master_planning_snapshot"/);
});

test("상세화면의 발주옵션과 중국옵션은 같은 정리된 B-code 집합으로 다시 그린다", () => {
  assert.match(guard, /reconcileModelOrderOptions/);
  assert.match(guard, /patch: \{ orderOptions: nextOptions \}/);
  assert.match(guard, /renderOptionTable\(nextOptions\)/);
  assert.match(guard, /renderChinaOptionPanel\(nextOptions\)/);
  assert.match(guard, /발주·입고 옵션가격과 B-code별 중국옵션은 동일한 B-code 집합/);
  assert.doesNotMatch(guard, /placeOrder|payOrder|checkout|fetch\([^)]*1688/i);
});

test("운영 상품출시 페이지가 B-code guard와 option-table authority를 로드한다", () => {
  assert.match(loader, /await import\("\.\/model-bcode-option-guard\.js"\)/);
  assert.match(loader, /await import\("\.\/china-option-table-authority\.js"\)/);
  assert.match(page, /20260815-china-option-table-authority-v1/);
});
