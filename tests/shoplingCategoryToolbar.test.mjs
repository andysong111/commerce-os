import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("샵플링 카테고리 버튼을 별도 관리 바로 이동하고 업데이트 명칭을 사용한다", async () => {
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
  assert.match(source, /insertBefore\(toolbar, bulkControls\)/);
  assert.match(source, /minWidth: primary \? "176px"/);
  assert.match(source, /whiteSpace: "nowrap"/);
  assert.match(app, /category-toolbar-layout\.js/);
});
