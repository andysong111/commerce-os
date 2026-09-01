import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v038/download/route.ts", import.meta.url);
const claimRoute = new URL("../src/app/api/shopling-market-group-canary/claim/route.ts", import.meta.url);

test("v0.3.8 package anchors work to goods keys visible in the active A18 page", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /const VERSION = "0\.3\.8"/);
  assert.match(source, /visibleProductGoodsKeys/);
  assert.match(source, /visibleGoodsKeys/);
  assert.match(source, /message\.visibleGoodsKeys/);
  assert.match(source, /visible_a18_goods_keys_missing/);
  assert.match(source, /extension-action-only-no-shopling-dom|shopling_dom_panel_present/);
});

test("server claim refuses invisible backlog and selects the first queued identity visible in A18", async () => {
  const source = await readFile(claimRoute, "utf8");
  assert.match(source, /group_canary_visible_goods_keys_required/);
  assert.match(source, /\.in\("goods_key", requestedVisibleGoodsKeys\)/);
  assert.match(source, /requestedVisibleGoodsKeys[\s\S]*\.map\(\(goodsKey\)/);
  assert.match(source, /anchoredToVisibleA18: true/);
  assert.doesNotMatch(source, /recentPartial/);
  assert.doesNotMatch(source, /group_canary_recent_sent_lookup_failed/);
});

test("v0.3.8 does not classify a slow A18 search as already registered", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /UNREGISTERED_RESULT_TIMEOUT_MS = 10000/);
  assert.match(source, /confirmed_zero_unregistered_results/);
  assert.match(source, /resultCount === 0 && age >= 1500/);
  assert.match(source, /unregistered_search_result_not_ready/);
});

test("v0.3.8 popup reconciles terminal runs after the in-page panel was removed", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /effectiveStatus/);
  assert.match(source, /running === 0 && total > 0 && states\.length >= total/);
  assert.match(source, /await chrome\.storage\.local\.set\(\{ \[RUN_STATE_KEY\]: nextRun \}\)/);
});
