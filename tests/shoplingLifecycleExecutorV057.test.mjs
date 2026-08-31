import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const executorPath = new URL(
  "../public/shopling-account-title-bridge/content-shopling-lifecycle-executor.js",
  import.meta.url,
);
const mainPath = new URL(
  "../public/shopling-account-title-bridge/content-shopling-lifecycle-main.js",
  import.meta.url,
);
const backgroundPath = new URL(
  "../public/shopling-account-title-bridge/background-shopling-lifecycle.js",
  import.meta.url,
);
const bridgeRoutePath = new URL(
  "../src/app/api/shopling-lifecycle-bridge/route.ts",
  import.meta.url,
);
const downloadRoutePath = new URL(
  "../src/app/api/shopling-account-title-bridge/download/route.ts",
  import.meta.url,
);

test("lifecycle executor parses and targets the diagnosed Shopling product-list controls", async () => {
  const source = await readFile(executorPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /const PRODUCT_LIST_PATH = "\/prod\/prodLst\.phtml"/);
  assert.match(source, /select\[name="sort_tp"\]/);
  assert.match(source, /setSelectValue\(sort, "A"\)/);
  assert.match(source, /select\[name="sale_status_chg"\]/);
  assert.match(source, /context\.desiredState === "SELLING" \? "B"/);
  assert.match(source, /context\.desiredState === "SOLD_OUT" \? "C"/);
  assert.match(source, /: "Z"/);
});

test("lifecycle executor mutates only one exact goods-key row and verifies again before success", async () => {
  const source = await readFile(executorPath, "utf8");
  assert.match(source, /function rowHasExactGoodsKey/);
  assert.match(source, /const rows = matchingRows\(context\.goodsKey\)/);
  assert.match(source, /rows\.length !== 1/);
  assert.match(source, /checkSingleRow\(rows\[0\]\)/);
  assert.match(source, /const STAGE_VERIFY = "verify-submitted"/);
  assert.match(source, /prepareSearch\(context, true\)/);
  const verifyBlock = source.indexOf('if (stage === STAGE_VERIFY)');
  const successCall = source.indexOf('finish(context, "succeeded"', verifyBlock);
  assert.ok(verifyBlock >= 0 && successCall > verifyBlock);
});

test("delete remains double-gated in isolated and main worlds", async () => {
  const executor = await readFile(executorPath, "utf8");
  const main = await readFile(mainPath, "utf8");
  assert.doesNotThrow(() => new Function(main));
  assert.match(executor, /context\.desiredState === "DELETE" && !context\.allowDelete/);
  assert.match(executor, /삭제 Canary가 서버에서 승인되지 않아 삭제를 실행하지 않았습니다/);
  assert.match(main, /action === "delete" && !allowDelete/);
  assert.match(main, /delete_canary_not_armed/);
  assert.match(main, /commerce_os_lifecycle.*=== "1"/s);
  assert.match(main, /del_submit\\s\*\\\(/);
  assert.match(main, /status_chg\\s\*\\\(/);
});

test("background executor is serialized, yields to existing Shopling workers, and times out fail-closed", async () => {
  const source = await readFile(backgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /SHOPLING_LIFECYCLE_EXECUTOR_ALARM/);
  assert.match(source, /limit:\s*1/);
  assert.match(source, /lifecycleOtherShoplingWorkerBusy/);
  assert.match(source, /commerceOsShoplingTitleBatchRun/);
  assert.match(source, /commerceOsShoplingPipelineMarketRun/);
  assert.match(source, /SHOPLING_LIFECYCLE_EXECUTOR_TIMEOUT_MS = 5 \* 60 \* 1000/);
  assert.match(source, /"confirm_needed"/);
  assert.match(source, /chrome\.tabs\.create/);
  assert.match(source, /active:\s*false/);
  assert.doesNotMatch(source, /document\.cookie|password/i);
});

test("server bridge claims only non-shadow pending work and never releases DELETE without explicit env gate", async () => {
  const source = await readFile(bridgeRoutePath, "utf8");
  assert.match(source, /SHOPLING_LIFECYCLE_DELETE_EXECUTION_ENABLED/);
  assert.match(source, /desired === "SELLING" \|\| desired === "SOLD_OUT"/);
  assert.match(source, /desired === "DELETE" && allowDelete/);
  assert.match(source, /\.eq\("status", "pending"\)/);
  assert.match(source, /\.eq\("shadow_mode", false\)/);
  assert.match(source, /STALE_CLAIM_MINUTES = 15/);
  assert.match(source, /status: "confirm_needed"/);
  assert.match(source, /deleteExecutionEnabled: allowDelete/);
});

test("download package upgrades baseline manifest to v0.5.7 with alarms and main-world executor", async () => {
  const source = await readFile(downloadRoutePath, "utf8");
  assert.match(source, /manifest\.version = "0\.5\.7"/);
  assert.match(source, /"alarms"/);
  assert.match(source, /content-shopling-lifecycle-executor\.js/);
  assert.match(source, /content-shopling-lifecycle-main\.js/);
  assert.match(source, /world: "MAIN"/);
  assert.match(source, /commerce-os-shopling-account-title-bridge-v0\.5\.7\.zip/);
  assert.match(source, /Commerce OS Shopling Account Title Bridge v0\.5\.7/);
});
