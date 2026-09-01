import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const listRoute = new URL("../src/app/api/shopling-market-group-canary/selection/list/route.ts", import.meta.url);
const claimRoute = new URL("../src/app/api/shopling-market-group-canary/selection/claim/route.ts", import.meta.url);
const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v039/download/route.ts", import.meta.url);

test("selection list is sourced from Commerce OS SEO bulk Shopling upload jobs, not A18 visibility", async () => {
  const source = await readFile(listRoute, "utf8");
  assert.match(source, /product_launch_upload_jobs/);
  assert.match(source, /seo-bulk-cloud/);
  assert.match(source, /latestByLaunch/);
  assert.match(source, /uploadSuccessCount/);
  assert.match(source, /marketDoneCount/);
  assert.match(source, /selectable/);
  assert.doesNotMatch(source, /visibleGoodsKeys|A18/);
});

test("selected claim locks exactly the latest successful six-channel upload batch", async () => {
  const source = await readFile(claimRoute, "utf8");
  assert.match(source, /jobId/);
  assert.match(source, /tasksFromJob\.length !== 6/);
  assert.match(source, /latestSeoBulkJobForLaunch/);
  assert.match(source, /shopling_selected_job_superseded/);
  assert.match(source, /superseded_by_selected_upload_batch/);
  assert.match(source, /excludeGoodsKeys/);
  assert.match(source, /slice\(0, maxTasks\)/);
  assert.match(source, /Math\.min[\s\S]*3/);
  assert.match(source, /submit_armed_at/);
});

test("v0.3.9 popup provides checkboxes and runs products sequentially with 3-channel waves", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /const VERSION = "0\.3\.9"/);
  assert.match(source, /data-job-id/);
  assert.match(source, /selectedCoordinatorTick/);
  assert.match(source, /attemptedGoodsKeys/);
  assert.match(source, /excludeGoodsKeys/);
  assert.match(source, /maxTasks: 3/);
  assert.match(source, /상품은 순차 처리/);
  assert.match(source, /3\+3/);
  assert.match(source, /selection\/list/);
  assert.match(source, /selection\/claim/);
  assert.match(source, /goods_key \+ 자사상품코드/);
});

test("v0.3.9 keeps Shopling A18 as execution template only and guards against control UI injection", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /A18 화면에 보이는 상품은 대상 선정에 사용하지 않습니다/);
  assert.match(source, /isProductListUi/);
  assert.match(source, /v039_shopling_dom_panel_present/);
  assert.match(source, /content\.includes\("document\.documentElement\.appendChild\(box\)"\)/);
});
