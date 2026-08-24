import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  reconcileModelOrderOptions,
  sameModelOrderOptions,
} from "../public/product-launch-tracker-app/lib/model-bcode-order-options.mjs";

const [route, guard, loader, page, workflowGate, stability, alignment] = await Promise.all([
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
  readFile("public/product-launch-tracker-app/workflow-ui-gate.js", "utf8"),
  readFile("public/product-launch-tracker-app/detail-state-stability.js", "utf8"),
  readFile("public/product-launch-tracker-app/option-barcode-column-alignment.js", "utf8"),
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

test("상세화면의 발주옵션과 중국옵션은 같은 정리된 B-code 집합으로 한 번만 다시 그린다", () => {
  assert.match(guard, /reconcileModelOrderOptions/);
  assert.match(guard, /patch: \{ orderOptions: nextOptions \}/);
  assert.match(guard, /renderOptionTable\(displayOptions\)/);
  assert.match(guard, /renderChinaOptionPanel\(displayOptions\)/);
  assert.match(guard, /inFlightKey/);
  assert.match(guard, /RECONCILE_DELAYS = \[90, 520, 1_500\]/);
  assert.match(guard, /발주·입고 옵션가격과 B-code별 중국옵션은 동일한 B-code 집합/);
  assert.doesNotMatch(guard, /placeOrder|payOrder|checkout|fetch\([^)]*1688/i);
});

test("옵션바코드NO 열은 기본 옵션행이 6칸으로 다시 그려져도 숫자 열을 밀지 않는다", () => {
  assert.match(alignment, /data-option-barcode-no-header/);
  assert.match(alignment, /data-field=\\?"optionBarcodeNo/);
  assert.match(alignment, /row\.insertBefore\(cell, anchor\)/);
  assert.match(alignment, /emptyCell\.setAttribute\("colspan", String\(expectedColumns\)\)/);
  assert.match(guard, /data-field=\"optionBarcodeNo\"/);
  assert.match(guard, /data-field=\"baseSalePriceKrw\"/);
  assert.ok(
    guard.indexOf('data-field="optionBarcodeNo"') <
      guard.indexOf('data-field="baseSalePriceKrw"'),
  );
});

test("상세 API는 늦게 도착한 이전 상품 응답을 현재 선택 상품으로 교체한다", () => {
  assert.match(stability, /latestDetailItemId/);
  assert.match(stability, /detailGeneration/);
  assert.match(stability, /requestedItemId !== latestDetailItemId/);
  assert.match(stability, /fetchAuthoritativeItemResponse\(latestDetailItemId/);
  assert.match(stability, /prepareDetailLoading/);
  assert.match(stability, /상품 옵션을 불러오는 중/);
});

test("상세 저장은 옵션바코드NO를 보존하고 서버 재조회 검증이 끝나야 성공한다", () => {
  assert.match(stability, /operation === "replace_item"/);
  assert.match(stability, /enrichReplaceMutation/);
  assert.match(stability, /firstValidOptionBarcode/);
  assert.match(stability, /verifyPersistedItem/);
  assert.match(stability, /compareEditableItem/);
  assert.match(stability, /저장 확인 실패/);
  assert.match(stability, /jsonErrorResponse\(\s*409/);
  assert.match(stability, /OPTION_BARCODE_PATTERN/);
});

test("상세 안정화 계층은 optimized app보다 먼저 설치된다", () => {
  assert.match(workflowGate, /installProductLaunchDetailStability\(\)/);
  assert.match(workflowGate, /installOptionBarcodeColumnAlignment\(\)/);
  assert.ok(
    workflowGate.indexOf("installProductLaunchDetailStability()") <
      workflowGate.indexOf('import("./optimized-app.js")'),
  );
});

test("운영 상품출시 페이지가 B-code guard와 option-table authority를 로드한다", () => {
  assert.match(loader, /await import\("\.\/model-bcode-option-guard\.js"\)/);
  assert.match(loader, /await import\("\.\/china-option-table-authority\.js"\)/);
  assert.match(page, /20260815-bidirectional-purchase-metadata-v1/);
});

test("상세 안정화 브라우저 모듈은 문법 검사를 통과한다", () => {
  for (const path of [
    "public/product-launch-tracker-app/detail-state-stability.js",
    "public/product-launch-tracker-app/option-barcode-column-alignment.js",
    "public/product-launch-tracker-app/model-bcode-option-guard.js",
  ]) {
    const checked = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  }
});
