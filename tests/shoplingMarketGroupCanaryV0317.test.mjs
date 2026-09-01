import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0317/download/route.ts", import.meta.url);

test("v0.3.17 adds cross-frame result evidence reconciliation", async () => {
  const source = await readFile(packageRoute, "utf8");
  for (const needle of [
    'const VERSION = "0.3.17"',
    'RESULT_FRAME_MESSAGE',
    'exactMallResultGoodsKey',
    'mallResultSnapshot',
    'broadcastMallResultEvidence',
    'resultFrameBus',
    'window.top.postMessage',
    'window.addEventListener("message"',
  ]) {
    assert.equal(source.includes(needle), true, `missing ${needle}`);
  }
});

test("v0.3.17 keeps all-frame settlement and non-Selpa failure safety", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.equal(source.includes('row?.goodsKey === state.task.goodsKey'), true);
  assert.equal(source.includes('resultFrameBus.values()'), true);
  assert.equal(source.includes('전체 결과 frame이 모일 때만 sent를 확정'), true);
  assert.equal(source.includes('셀파 외 실패가 하나라도 있으면'), true);
});

test("v0.3.17 safely stops workers that lose the Shopling admin shell", async () => {
  const source = await readFile(packageRoute, "utf8");
  for (const needle of [
    'ADMIN_SHELL_TIMEOUT_MS = 15000',
    'shopling_admin_shell_unavailable',
    'prod_rgst_(?:rspt|tsrmt)',
  ]) {
    assert.equal(source.includes(needle), true, `missing ${needle}`);
  }
});
