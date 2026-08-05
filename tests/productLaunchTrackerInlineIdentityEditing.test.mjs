import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeInlineModelNumber,
  updateTrackerIdentityState,
} from "../public/product-launch-tracker-app/inline-identity-editors.js";
import { rememberInlineOptionsEditor } from "../public/product-launch-tracker-app/inline-options-focus-guard.js";
import { migrateTrackerModelNumbers } from "../public/product-launch-tracker-app/tracker-seed-model-migrations.js";

const appSource = await readFile(
  new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
  "utf8",
);
const identitySource = await readFile(
  new URL("../public/product-launch-tracker-app/inline-identity-editors.js", import.meta.url),
  "utf8",
);
const focusSource = await readFile(
  new URL("../public/product-launch-tracker-app/inline-options-focus-guard.js", import.meta.url),
  "utf8",
);

test("모델번호와 모델명 인라인 편집 모듈 및 옵션 포커스 보호가 앱에 연결된다", () => {
  assert.match(appSource, /tracker-seed-model-migrations\.js/);
  assert.match(appSource, /inline-options-focus-guard\.js/);
  assert.match(appSource, /inline-identity-editors\.js/);
  assert.match(focusSource, /\.inline-options-editor/);
  assert.match(identitySource, /inline-model-number-editor/);
  assert.match(identitySource, /inline-product-name-editor/);
  assert.match(identitySource, /barcode-required-empty/);
});

test("인라인 모델번호는 AAA 형식으로 정규화하고 저장 시 삭제 보호 목록을 보존한다", () => {
  assert.equal(normalizeInlineModelNumber(" aaa0452 "), "AAA452");
  const now = "2026-08-05T13:30:00.000Z";
  const original = {
    schemaVersion: 3,
    serverDeletedItemIds: ["deleted-1"],
    items: [
      { id: "item-1", modelNumber: "AAA451", productName: "반자동 책갈피 3P 색상랜덤" },
    ],
  };
  const result = updateTrackerIdentityState(
    original,
    "item-1",
    "modelNumber",
    "aaa452",
    now,
  );
  assert.equal(result.changed, true);
  assert.equal(result.state.items[0].modelNumber, "AAA452");
  assert.deepEqual(result.state.serverDeletedItemIds, ["deleted-1"]);
  assert.equal(result.state.savedAt, now);
});

test("정적 초기 데이터와 오래된 브라우저 데이터의 AAA451 책갈피만 AAA452로 이관한다", () => {
  const input = {
    items: [
      { id: "target", modelNumber: "AAA451", productName: "반자동 책갈피 3P 색상랜덤" },
      { id: "other", modelNumber: "AAA451", productName: "다른 상품" },
    ],
  };
  const migrated = migrateTrackerModelNumbers(input, "2026-08-05T13:30:00.000Z");
  assert.equal(migrated.changed, true);
  assert.equal(migrated.value.items[0].modelNumber, "AAA452");
  assert.equal(migrated.value.items[1].modelNumber, "AAA451");
});

test("같은 바코드의 기존 AAA452가 있으면 완료 행을 보존하고 AAA451 중복 행을 삭제 보호한다", () => {
  const input = {
    serverDeletedItemIds: ["older-delete"],
    items: [
      {
        id: "duplicate-451",
        modelNumber: "AAA451",
        productName: "반자동 책갈피 3P 색상랜덤",
        barcode: "BCB7-1",
        stages: { detailPage: { status: "미시작" } },
        source: { rows: [2478] },
      },
      {
        id: "canonical-452",
        modelNumber: "AAA452",
        productName: "반자동 책갈피 3p 색상랜덤",
        barcode: "BCB7-1",
        stages: { detailPage: { status: "완료" } },
        source: { rows: [2376] },
      },
    ],
  };
  const migrated = migrateTrackerModelNumbers(input, "2026-08-05T13:30:00.000Z");
  assert.equal(migrated.changed, true);
  assert.equal(migrated.value.items.length, 1);
  assert.equal(migrated.value.items[0].id, "canonical-452");
  assert.equal(migrated.value.items[0].modelNumber, "AAA452");
  assert.equal(migrated.value.items[0].productName, "반자동 책갈피 3P 색상랜덤");
  assert.equal(migrated.value.items[0].stages.detailPage.status, "완료");
  assert.deepEqual(migrated.value.items[0].source.rows.sort(), [2376, 2478]);
  assert.deepEqual(
    migrated.value.serverDeletedItemIds.sort(),
    ["duplicate-451", "older-delete"],
  );
});

test("옵션 포커스 기억 함수는 브라우저가 아닌 테스트 환경에서 안전하게 무시한다", () => {
  assert.equal(rememberInlineOptionsEditor(null), null);
});
