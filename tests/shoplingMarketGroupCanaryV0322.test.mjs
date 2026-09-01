import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0322/download/route.ts", import.meta.url);

test("v0.3.22 treats any Shopling success as channel success", async () => {
  const source = await readFile(packageRoute, "utf8");
  for (const needle of [
    'const VERSION = "0.3.22"',
    "if (hasSuccess) {",
    "shopling_result_any_success_v0322",
    "shopling_submit_any_success_parallel_worker_v0322",
    "성공이 1건 이상이면",
    "성공이 0건이고 실패만",
    "outcome = 'sent'",
    "outcome = 'confirm_needed'",
  ]) {
    assert.equal(source.includes(needle), true, `missing ${needle}`);
  }
});
