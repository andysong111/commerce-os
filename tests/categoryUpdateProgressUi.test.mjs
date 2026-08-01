import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("카테고리 업데이트는 최신화 문구를 정규화하고 진행창을 표시한다", async () => {
  const source = await readFile(
    new URL(
      "../public/product-launch-tracker-app/category-update-progress.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /replaceAll\("최신화", "업데이트"\)/);
  assert.match(source, /샵플링 카테고리 업데이트 진행 중/);
  assert.match(source, /category-update-progress-backdrop/);
  assert.match(source, /category-update-progress-bar/);
  assert.match(source, /경과 0초/);
  assert.match(source, /manual_login_required/);
  assert.match(source, /GitHub Actions 열기/);
  assert.match(source, /CATEGORY_UPDATE_SESSION_KEY/);
});

test("진행창 스크립트는 카테고리 UI 뒤에 로드된다", async () => {
  const app = await readFile(
    new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
    "utf8",
  );
  const categoryAiIndex = app.indexOf("category-ai.js");
  const toolbarIndex = app.indexOf("category-toolbar-layout.js");
  const progressIndex = app.indexOf("category-update-progress.js");
  assert.ok(categoryAiIndex >= 0);
  assert.ok(toolbarIndex > categoryAiIndex);
  assert.ok(progressIndex > toolbarIndex);
});
