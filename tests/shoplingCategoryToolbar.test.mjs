import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("샵플링 카테고리 관리 바를 일괄작업과 분리하고 업데이트 명칭을 사용한다", async () => {
  const source = await readFile(
    new URL(
      "../public/product-launch-tracker-app/category-toolbar-layout.js",
      import.meta.url,
    ),
    "utf8",
  );
  const app = await readFile(
    new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /shopling-category-management-toolbar/);
  assert.match(source, /샵플링 카테고리 업데이트/);
  assert.match(source, /최초 업데이트 필요/);
  assert.match(source, /workspace\.insertBefore\(toolbar, bulkbar\)/);
  assert.match(source, /grid-template-columns: repeat\(3, minmax\(220px, 1fr\)\)/);
  assert.match(source, /단계·상태 변경/);
  assert.match(source, /선택 상품 작업/);
  assert.match(source, /표 보기 설정/);
  assert.match(source, /writing-mode: horizontal-tb/);
  assert.match(source, /white-space: nowrap !important/);
  assert.match(source, /bulk-action-group-status/);
  assert.match(source, /bulk-action-group-data/);
  assert.match(source, /bulk-action-group-view/);
  assert.match(app, /category-toolbar-layout\.js/);
});
