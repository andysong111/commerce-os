import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0314/download/route.ts", import.meta.url);

test("v0.3.14 recovers lost Shopling result popup context by active goods_key", async () => {
  const source = await readFile(packageRoute, "utf8");
  for (const needle of [
    'const VERSION = "0.3.14"',
    'rawCandidateGoodsKeys',
    'candidateGoodsKeys.has(text(candidate.goodsKey))',
    'message.candidateGoodsKeys',
    'resultContextGoodsKeys',
    'candidateGoodsKeys: resultContextGoodsKeys()',
    'RESULT CONTEXT RECOVERY',
  ]) {
    assert.equal(source.includes(needle), true, `missing ${needle}`);
  }
});

test("v0.3.14 keeps result fallback restricted to Shopling result pages and active assignments", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /if \(!isSubmitResultPage\(\) && !isMallResultFrame\(\)\) return \[\]/);
  assert.match(source, /candidate\?\.status === "active"/);
});
