import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0311/download/route.ts", import.meta.url);

test("v0.3.11 starts selected Shopling work through shared storage instead of waiting on a message port", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /const VERSION = "0\.3\.11"/);
  assert.match(source, /await chrome\.storage\.local\.set\(\{ \[QUEUE_KEY\]: queue \}\)/);
  assert.match(source, /await chrome\.tabs\.reload\(tab\.id\)/);
  assert.match(source, /await sleep\(900\)/);
  assert.match(source, /A18 실행기가 자동 시작합니다/);
  assert.match(source, /message port/);
});

test("v0.3.11 preserves selection-mode safety and no Shopling DOM control panel", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /Commerce OS SEO 대량등록 Shopling 업로드/);
  assert.match(source, /상품별 순차 \/ 채널 3\+3 병렬/);
  assert.match(source, /A18 화면 상품목록과 무관/);
  assert.match(source, /v0311_shopling_dom_panel_present/);
});
