import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bridgePath = new URL(
  "../src/app/api/shopling-lifecycle-bridge/route.ts",
  import.meta.url,
);

test("lifecycle bridge preflights SELLING and SOLD_OUT before browser claim", async () => {
  const source = await readFile(bridgePath, "utf8");
  assert.match(source, /loadShoplingLifecycleStatusSnapshot/);
  assert.match(source, /desired === "SELLING"/);
  assert.match(source, /desired === "SOLD_OUT"/);
  assert.match(source, /desiredSaleStatusCode/);
  assert.match(source, /return "B"/);
  assert.match(source, /return "C"/);
  assert.match(source, /preflightCurrentSaleStatus/);
  assert.match(source, /preflightSource: "shopling_product_read_api"/);
});

test("matching current status succeeds as noop without browser claim", async () => {
  const source = await readFile(bridgePath, "utf8");
  const noopBlock = source.indexOf('preflight.currentSaleStatus === desiredCode');
  const succeeded = source.indexOf('status: "succeeded"', noopBlock);
  const continueIndex = source.indexOf("continue;", succeeded);
  const claimed = source.indexOf('status: "claimed"', noopBlock);
  assert.ok(noopBlock >= 0 && succeeded > noopBlock && continueIndex > succeeded);
  assert.ok(claimed === -1 || continueIndex < claimed);
  assert.match(source, /preflightNoopCount/);
  assert.match(source, /noop: true/);
});

test("noop-only canary never reaches browser when current status differs or preflight fails", async () => {
  const source = await readFile(bridgePath, "utf8");
  assert.match(source, /canaryNoopOnly === true/);
  assert.match(source, /status: "confirm_needed"/);
  assert.match(source, /브라우저 변경을 실행하지 않았습니다/);
  assert.match(source, /preflightBlockedCanaryCount/);
  assert.match(source, /preflightError/);
});

test("DELETE remains behind the existing explicit execution gate", async () => {
  const source = await readFile(bridgePath, "utf8");
  assert.match(source, /SHOPLING_LIFECYCLE_DELETE_EXECUTION_ENABLED/);
  assert.match(source, /desired === "DELETE" && allowDelete/);
  assert.doesNotMatch(source, /desiredSaleStatusCode[\s\S]{0,160}return "Z"/);
});
