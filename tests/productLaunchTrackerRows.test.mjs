import assert from "node:assert/strict";
import test from "node:test";
import {
  assignProductLaunchTrackerRowNumbers,
  formatProductLaunchTrackerRowExpression,
  parseProductLaunchTrackerRowExpression,
  resolveProductLaunchTrackerSelection,
} from "../src/lib/productLaunchTrackerRows.ts";

test("진행관리 원본 행번호를 우선 사용하고 중복·신규 행은 충돌 없이 고정 배정한다", () => {
  const rows = assignProductLaunchTrackerRowNumbers([
    { id: "a", source: { rows: [2430] } },
    { id: "b", source: { rows: [2432] } },
    { id: "c", source: { rows: [2430] } },
    { id: "d" },
  ]);
  assert.deepEqual(
    rows.map((entry) => entry.trackerRowNumber),
    [2430, 2432, 2433, 2434],
  );
});

test("진행관리 행 범위와 쉼표 입력을 순서대로 해석한다", () => {
  assert.deepEqual(
    parseProductLaunchTrackerRowExpression("2430-2432,2440,2431"),
    [2430, 2431, 2432, 2440],
  );
  assert.equal(
    formatProductLaunchTrackerRowExpression([2440, 2432, 2431, 2430]),
    "2430-2432,2440",
  );
});

test("체크 선택 ID와 직접 입력 행번호를 중복 없이 함께 선택한다", () => {
  const items = [
    { id: "a", source: { rows: [2430] } },
    { id: "b", source: { rows: [2432] } },
    { id: "c", source: { rows: [2434] } },
  ];
  const selected = resolveProductLaunchTrackerSelection(items, {
    itemIds: ["b"],
    rowExpression: "2430,2432",
    maxItems: 20,
  });
  assert.deepEqual(
    selected.map((entry) => entry.item.id),
    ["b", "a"],
  );
  assert.deepEqual(
    selected.map((entry) => entry.trackerRowNumber),
    [2432, 2430],
  );
});

test("존재하지 않는 진행관리 행번호는 조용히 무시하지 않고 차단한다", () => {
  assert.throws(
    () =>
      resolveProductLaunchTrackerSelection(
        [{ id: "a", source: { rows: [2430] } }],
        { rowExpression: "9999" },
      ),
    /찾을 수 없는 진행관리 행번호: 9999/,
  );
});
