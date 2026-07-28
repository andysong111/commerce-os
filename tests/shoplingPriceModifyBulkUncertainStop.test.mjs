import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("every auto uncertainty path records a durable stop before later progression", async () => {
  const source = await read("src/lib/shoplingPriceModifyBulkAutoOrchestrator.ts");

  assert.match(source, /async function stopAfterUncertain/);
  assert.match(source, /await blockUncertain\([\s\S]*?return stopAuto\(/);
  assert.match(source, /전송 상태가 불확실하여 자동 실행을 중단했습니다/);
  assert.match(source, /same request_id as uncertain first|same request_id/);

  for (const type of ["canary", "normal", "retry"]) {
    const calls = source.match(new RegExp(`stopAfterUncertain\\(admin, "${type}"`, "g")) ?? [];
    assert.ok(calls.length >= 3, `${type} must stop for mark failure, uncertain response, and timeout/result recovery`);
  }

  assert.match(source, /if \(job\.status === "dispatch_uncertain"\)[\s\S]*?if \(!stopped\)[\s\S]*?return stopAuto/);
  assert.match(source, /Never inspect a result until the stop marker is durable/);
});

test("dispatching results are not saved until the uncertainty stop marker is written", async () => {
  const source = await read("src/lib/shoplingPriceModifyBulkAutoOrchestrator.ts");

  for (const type of ["canary", "normal", "retry"]) {
    const functionName = type === "canary" ? "processCanaryResult" : type === "normal" ? "processNormalResult" : "processRetryResult";
    const start = source.indexOf(`async function ${functionName}`);
    assert.ok(start >= 0, `${functionName} missing`);
    const next = source.indexOf("\nasync function ", start + 1);
    const block = source.slice(start, next >= 0 ? next : undefined);
    assert.match(block, /if \(chunk\.status === "dispatching"\) \{[\s\S]*?return stopAfterUncertain/);
  }
});

test("a stopped uncertain result may finish only the current request and never dispatch the next chunk", async () => {
  const source = await read("src/lib/shoplingPriceModifyBulkAutoOrchestrator.ts");

  assert.match(source, /job\.status === "dispatch_uncertain"[\s\S]*?processSingleActiveChunk/);
  assert.match(source, /job\.status === "canary_succeeded"[\s\S]*?if \(stopped\)[\s\S]*?normalCount === 0[\s\S]*?finishAuto/);
  assert.match(source, /job\.status === "normal_running"[\s\S]*?if \(active\.length === 1\)[\s\S]*?if \(stopped\)[\s\S]*?outcome: "noop"/);
  assert.match(source, /job\.status === "retry_running"[\s\S]*?if \(active\.length === 1\)[\s\S]*?if \(stopped\)[\s\S]*?outcome: "noop"/);
  assert.doesNotMatch(source, /job\.status === "dispatch_uncertain"[\s\S]{0,800}generateShoplingPriceModifyRequestId/);
});
