import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("카테고리 업데이트 백그라운드 버튼은 클릭 버블링을 차단하고 전역 작업을 등록한다", async () => {
  const bridge = await source(
    "public/product-launch-tracker-app/category-update-work-assistant-bridge.js",
  );
  const app = await source("public/product-launch-tracker-app/app.js");

  assert.match(bridge, /category-update-progress-minimize/);
  assert.match(bridge, /stopImmediatePropagation/);
  assert.match(bridge, /backdrop\.hidden = true/);
  assert.match(bridge, /commerce-os-work-assistant:category-update:v1/);
  assert.match(bridge, /category-update-task-changed/);
  assert.match(bridge, /window\.parent\.postMessage/);
  assert.match(app, /category-update-work-assistant-bridge\.js/);
});

test("실시간 작업 도우미는 샵플링 카테고리 업데이트를 상태 API로 추적한다", async () => {
  const assistant = await source("src/components/OpsWorkAssistant.tsx");

  assert.match(assistant, /실시간 작업 도우미/);
  assert.match(assistant, /샵플링 카테고리 업데이트/);
  assert.match(assistant, /commerce-os-work-assistant:category-update:v1/);
  assert.match(assistant, /api\/shopling-categories\/status/);
  assert.match(assistant, /manual_login_required/);
  assert.match(assistant, /CategoryUpdateCard/);
  assert.match(assistant, /업데이트 화면/);
  assert.match(assistant, /현재 진행 중인 작업/);
});
