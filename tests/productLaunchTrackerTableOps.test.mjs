import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyInlineOptionLabels,
  buildFrozenColumnGeometry,
  DEFAULT_TABLE_COLUMN_ORDER,
  frozenColumnKeys,
  moveColumn,
  normalizeColumnOrder,
  parseInlineOptionLabels,
} from "../public/product-launch-tracker-app/lib/table-inline-ops.mjs";

test("열 순서는 선택 열을 첫 번째로 유지하고 누락 열을 복원한다", () => {
  const order = normalizeColumnOrder([
    "productName",
    "options",
    "productName",
    "unknown",
    "select",
  ]);
  assert.equal(order[0], "select");
  assert.equal(order[1], "productName");
  assert.equal(order[2], "options");
  assert.deepEqual(new Set(order), new Set(DEFAULT_TABLE_COLUMN_ORDER));
});

test("열 드래그 이동과 선택 열까지 고정 범위를 계산한다", () => {
  const moved = moveColumn(DEFAULT_TABLE_COLUMN_ORDER, "options", "modelNumber");
  assert.ok(moved.indexOf("options") < moved.indexOf("modelNumber"));
  assert.equal(moved[0], "select");
  assert.deepEqual(
    frozenColumnKeys(moved, "modelNumber"),
    moved.slice(0, moved.indexOf("modelNumber") + 1),
  );
  assert.deepEqual(frozenColumnKeys(moved, ""), []);
});

test("고정 열은 헤더와 행 중 가장 넓은 폭으로 빈틈 없는 좌표를 만든다", () => {
  const geometry = buildFrozenColumnGeometry([
    { key: "select", widths: [42, 42] },
    { key: "workBatch", widths: [78, 92] },
    { key: "barcode", widths: [120, 240] },
    { key: "modelNumber", widths: [90, 168] },
    { key: "productName", widths: [64, 176] },
  ]);
  assert.deepEqual(geometry, [
    { key: "select", left: 0, width: 42, right: 42 },
    { key: "workBatch", left: 42, width: 92, right: 134 },
    { key: "barcode", left: 134, width: 240, right: 374 },
    { key: "modelNumber", left: 374, width: 168, right: 542 },
    { key: "productName", left: 542, width: 176, right: 718 },
  ]);
});

test("표 옵션 입력은 쉼표 구분·중복 제거 후 기존 가격과 바코드를 순서대로 유지한다", () => {
  const labels = parseInlineOptionLabels("블랙, 화이트\n블랙, 대형");
  assert.deepEqual(labels, ["블랙", "화이트", "대형"]);
  const applied = applyInlineOptionLabels(
    [
      {
        id: "a",
        optionName: "색상",
        saleOption: "기존1",
        barcode: "BAA1-1",
        baseSalePriceKrw: 10000,
        unitCostKrw: 5000,
      },
      {
        id: "b",
        optionName: "색상",
        saleOption: "기존2",
        barcode: "BAA1-2",
        baseSalePriceKrw: 12000,
        unitCostKrw: 6000,
      },
    ],
    labels,
  );
  assert.equal(applied[0].saleOption, "블랙");
  assert.equal(applied[0].barcode, "BAA1-1");
  assert.equal(applied[0].baseSalePriceKrw, 10000);
  assert.equal(applied[1].saleOption, "화이트");
  assert.equal(applied[1].barcode, "BAA1-2");
  assert.equal(applied[2].saleOption, "대형");
  assert.equal(applied[2].barcode, "");
});

test("진행관리 표 UI는 직접입력·열 드래그·열 고정·선택 일괄 불러오기를 포함한다", async () => {
  const source = await readFile(
    new URL(
      "../public/product-launch-tracker-app/table-inline-ops.js",
      import.meta.url,
    ),
    "utf8",
  );
  const loader = await readFile(
    new URL(
      "../public/product-launch-tracker-app/table-inline-ops-loader.js",
      import.meta.url,
    ),
    "utf8",
  );
  const frozenFix = await readFile(
    new URL(
      "../public/product-launch-tracker-app/table-frozen-columns-fix.js",
      import.meta.url,
    ),
    "utf8",
  );
  const app = await readFile(
    new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /inline-category-editor/);
  assert.match(source, /inline-options-editor/);
  assert.match(source, /column-drag-handle/);
  assert.match(source, /freeze-through-column/);
  assert.match(source, /bulk-china-order-sync-button/);
  assert.match(source, /china-order-options\?/);
  assert.match(source, /TRACKER_STATE_ENDPOINT/);
  assert.match(loader, /safeObserver\.disconnect/);
  assert.match(loader, /dispatchEvent\(new Event\("resize"\)\)/);
  assert.match(frozenFix, /buildFrozenColumnGeometry/);
  assert.match(frozenFix, /cell\.offsetWidth/);
  assert.match(frozenFix, /cell\.style\.minWidth = width/);
  assert.match(frozenFix, /cell\.style\.maxWidth = width/);
  assert.match(frozenFix, /background-clip: border-box !important/);
  assert.match(frozenFix, /z-index: 40 !important/);
  assert.match(app, /table-inline-ops-loader\.js/);
  assert.match(app, /table-frozen-columns-fix\.js/);
});
