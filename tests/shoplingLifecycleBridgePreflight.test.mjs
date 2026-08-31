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

test("matching current status succeeds as server noop unless an explicitly verified browser noop canary is armed", async () => {
  const source = await readFile(bridgePath, "utf8");
  assert.match(source, /forceBrowserNoopCanary === true/);
  assert.match(source, /strictNoopCanary/);
  assert.match(source, /verifiedSameState/);
  assert.match(source, /if \(verifiedSameState && !forceBrowser\)/);
  assert.match(source, /status: "succeeded"/);
  assert.match(source, /preflightNoopCount/);
  assert.match(source, /noop: true/);
});

test("all strict noop canaries block browser mutation unless current state is already the requested state", async () => {
  const source = await readFile(bridgePath, "utf8");
  assert.match(source, /canaryNoopOnly === true/);
  assert.match(source, /forceBrowserNoopCanary === true/);
  assert.match(source, /strictNoopCanary\(evidence\) && !verifiedSameState/);
  assert.match(source, /status: "confirm_needed"/);
  assert.match(source, /브라우저 변경을 실행하지 않았습니다/);
  assert.match(source, /preflightBlockedCanaryCount/);
  assert.match(source, /preflightError/);
});

test("verified force-browser noop canary can be claimed only after the read API proves same state", async () => {
  const source = await readFile(bridgePath, "utf8");
  const verified = source.indexOf("const verifiedSameState");
  const serverNoop = source.indexOf("if (verifiedSameState && !forceBrowser)", verified);
  const strictBlock = source.indexOf("strictNoopCanary(evidence) && !verifiedSameState", serverNoop);
  const browserClaim = source.indexOf('status: "claimed"', strictBlock);
  assert.ok(verified >= 0 && serverNoop > verified && strictBlock > serverNoop && browserClaim > strictBlock);
});

test("DELETE remains behind the existing explicit execution gate", async () => {
  const source = await readFile(bridgePath, "utf8");
  assert.match(source, /SHOPLING_LIFECYCLE_DELETE_EXECUTION_ENABLED/);
  assert.match(source, /desired === "DELETE" && allowDelete/);
  assert.doesNotMatch(source, /desiredSaleStatusCode[\s\S]{0,160}return "Z"/);
});
