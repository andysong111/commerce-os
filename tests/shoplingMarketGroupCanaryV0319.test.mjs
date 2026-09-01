import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0319/download/route.ts", import.meta.url);

test("v0.3.19 adds cassnet result frame host access", async () => {
  const source = await readFile(packageRoute, "utf8");
  for (const needle of [
    'const VERSION = "0.3.19"',
    '*://*.cassnet.co.kr/*',
    '(?:shopling|cassnet)\\\\.co\\\\.kr',
    'host_permissions',
    'content_scripts',
  ]) {
    assert.equal(source.includes(needle), true, `missing ${needle}`);
  }
});

test("v0.3.19 keeps one A18 control tab and result auto-finalization intent", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.equal(source.includes('관리자 A18 원본 탭은 1개면 충분'), true);
  assert.equal(source.includes('1차 3채널 결과가 원장에 확정되지 않아 2차 3채널이 멈추는 현상을 제거'), true);
  assert.equal(source.includes('getV0318Package'), true);
});
