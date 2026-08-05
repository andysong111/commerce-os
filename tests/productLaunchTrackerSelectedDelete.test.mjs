import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDeletedTrackerState } from "../public/product-launch-tracker-app/selected-row-delete.js";
import { filterDeletedSeedItems } from "../public/product-launch-tracker-app/tracker-deleted-seed-filter.js";

const entrySource = await readFile(
  new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
  "utf8",
);
const deleteSource = await readFile(
  new URL("../public/product-launch-tracker-app/selected-row-delete.js", import.meta.url),
  "utf8",
);

test("진행관리 앱은 초기 데이터 복원 방지 후 선택 삭제 기능을 연결한다", () => {
  assert.match(
    entrySource,
    /tracker-deleted-seed-filter\.js[\s\S]*bootstrap\.js[\s\S]*selected-row-delete\.js/,
  );
  assert.match(deleteSource, /delete-selected-button/);
  assert.match(deleteSource, /window\.confirm/);
  assert.match(deleteSource, /product-launch-tracker:external-state/);
});

test("선택 삭제는 상품을 제거하고 기존 삭제 ID와 합쳐 영구 보존한다", () => {
  const stored = {
    schemaVersion: 3,
    items: [
      { id: "one", modelNumber: "AAA001" },
      { id: "two", modelNumber: "AAA002" },
      { id: "three", modelNumber: "AAA003" },
    ],
    serverDeletedItemIds: ["old"],
  };

  const result = buildDeletedTrackerState(
    stored,
    new Set(["one", "three", "missing"]),
    "2026-08-05T13:20:00.000Z",
  );

  assert.deepEqual(result.deletedIds, ["one", "three"]);
  assert.deepEqual(result.nextState.items.map((item) => item.id), ["two"]);
  assert.deepEqual(
    new Set(result.nextState.serverDeletedItemIds),
    new Set(["old", "one", "three"]),
  );
  assert.equal(result.nextState.savedAt, "2026-08-05T13:20:00.000Z");
});

test("삭제된 초기 행은 새로고침용 시드 데이터에서도 다시 생성되지 않는다", () => {
  const seed = {
    meta: { launchItemCount: 3 },
    items: [{ id: "one" }, { id: "two" }, { id: "three" }],
  };

  const filtered = filterDeletedSeedItems(seed, ["one", "three"]);
  assert.deepEqual(filtered.items.map((item) => item.id), ["two"]);
  assert.equal(filtered.meta.launchItemCount, 1);
  assert.equal(seed.items.length, 3);
});
