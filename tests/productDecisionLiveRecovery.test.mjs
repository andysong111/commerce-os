import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const recovery = await readFile(
  "src/lib/productDecisionLiveRecovery.ts",
  "utf8",
);
const cron = await readFile(
  "src/app/api/cron/product-decision-live-refresh/route.ts",
  "utf8",
);

test("automatic recovery is limited to the one pre-TLS-fix fetch failure", () => {
  assert.match(
    recovery,
    /LEGACY_SHOPLING_FETCH_FAILURE_CUTOFF[\s\S]*2026-08-05T16:16:04\.000Z/,
  );
  assert.match(recovery, /status\.state !== "FAILED"/);
  assert.match(recovery, /\^\(\?:order\|claim\):/);
  assert.match(recovery, /status\.error\?\.trim\(\)\.toLowerCase\(\) !== "fetch failed"/);
  assert.match(recovery, /parsed < Date\.parse\(LEGACY_SHOPLING_FETCH_FAILURE_CUTOFF\)/);
  assert.doesNotMatch(recovery, /setInterval|while \(true\)|for \(;;\)/);
});

test("recovery proves the read-only Shopling transport before creating one replacement request", () => {
  const diagnosticIndex = recovery.indexOf("runShoplingOrderNetworkDiagnostic()");
  const createIndex = recovery.indexOf("createProductDecisionLiveRefreshRequest()");
  assert.ok(diagnosticIndex >= 0);
  assert.ok(createIndex > diagnosticIndex);
  assert.match(recovery, /if \(!diagnostic\.ok\)/);
  assert.match(recovery, /reason: "SHOPLING_DIAGNOSTIC_FAILED"/);
  assert.match(recovery, /reason: "RECOVERED"/);
  assert.doesNotMatch(recovery, /price.*change|inventory.*write|1688/i);
});

test("the minute worker recovers first and then processes the new request immediately", () => {
  assert.match(cron, /recoverLegacyShoplingFetchFailure/);
  const recoveryIndex = cron.indexOf("await recoverLegacyShoplingFetchFailure()");
  const stepIndex = cron.indexOf("await runProductDecisionLiveRefreshStep()");
  assert.ok(recoveryIndex >= 0);
  assert.ok(stepIndex > recoveryIndex);
  assert.match(cron, /recovery,/);
  assert.match(cron, /Bearer \$\{expected\}/);
});
