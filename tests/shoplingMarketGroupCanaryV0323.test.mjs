import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0323/download/route.ts", import.meta.url);
const listRoute = new URL("../src/app/api/shopling-market-group-canary/selection/list/route.ts", import.meta.url);

test("v0.3.23 separates legacy unknown registration from true pending", async () => {
  const [pkg, list] = await Promise.all([readFile(packageRoute, "utf8"), readFile(listRoute, "utf8")]);
  for (const needle of [
    'const VERSION = "0.3.23"',
    "registrationUnknownCount",
    "실등록 확인",
    "A18 미등록 검색",
  ]) {
    assert.equal((pkg + list).includes(needle), true, `missing ${needle}`);
  }
  assert.equal(list.includes('const LEGACY_UNKNOWN = new Set(["legacy_ignored"])'), true);
  assert.equal(list.includes("registrationUnknownCount += 1"), true);
  assert.equal(list.includes("marketPendingCount: pendingCount"), true);
});
