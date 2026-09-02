import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0328/download/route.ts", import.meta.url);
const listRoute = new URL("../src/app/api/shopling-market-group-canary/selection/list/route.ts", import.meta.url);
const claimAllRoute = new URL("../src/app/api/shopling-market-group-canary/selection/claim-all/route.ts", import.meta.url);

test("v0.3.28 recovers result goods_key from numeric tokens and server context", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /const VERSION = "0\.3\.28"/);
  assert.match(source, /numericTokens/);
  assert.match(source, /activeMatches/);
  assert.match(source, /recoveredByTokens/);
  assert.match(source, /resultContextApi\(tokenCandidates\.slice\(0, 20\)\)/);
});

test("selection list allows stale or exception rows to be explicitly resumed but keeps fresh busy rows locked", async () => {
  const source = await readFile(listRoute, "utf8");
  assert.match(source, /STALE_BUSY_MS = 3 \* 60 \* 1000/);
  assert.match(source, /staleBusyCount/);
  assert.match(source, /activeBusyCount === 0/);
  assert.match(source, /actionableCount > 0/);
});

test("explicit selection reopens uncertain rows only through A18 exact preflight workflow", async () => {
  const source = await readFile(claimAllRoute, "utf8");
  assert.match(source, /selected_confirm_reconcile_v0328/);
  assert.match(source, /selected_stale_submit_reconcile_v0328/);
  assert.match(source, /submit_armed_at: null/);
  assert.match(source, /A18 미등록 정확조회/);
});
