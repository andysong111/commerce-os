import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertNoTestRegressions, parseTapResult } from "../scripts/reliability-autofix-test-delta.mjs";

const tap = ({ tests = 2, passed = 1, failed = [], skipped = 0, cancelled = 0, todo = 0 }) => {
  const failures = failed
    .map(
      ({ number, title, file, line = 10 }) =>
        `not ok ${number} - ${title}\n  ---\n  location: '/home/runner/work/repo/repo/tests/${file}:${line}:1'\n  failureType: 'testCodeFailure'\n  error: 'expected failure'\n  ...`,
    )
    .join("\n");
  return `TAP version 13\n${failures}\n1..${tests}\n# tests ${tests}\n# pass ${passed}\n# fail ${failed.length}\n# cancelled ${cancelled}\n# skipped ${skipped}\n# todo ${todo}\n`;
};

test("baseline failures remain allowed when the candidate adds no new failure", () => {
  const baseline = tap({
    failed: [{ number: 1, title: "stale UI assertion", file: "existing.test.mjs", line: 20 }],
  });
  const candidate = tap({
    tests: 3,
    passed: 2,
    failed: [{ number: 1, title: "stale UI assertion", file: "existing.test.mjs", line: 44 }],
  });
  assert.doesNotThrow(() => assertNoTestRegressions(baseline, candidate));
});

test("a new candidate failure is rejected even when the total failure count stays unchanged", () => {
  const baseline = tap({
    failed: [{ number: 1, title: "old failure", file: "old.test.mjs" }],
  });
  const candidate = tap({
    failed: [{ number: 1, title: "new failure", file: "new.test.mjs" }],
  });
  assert.throws(() => assertNoTestRegressions(baseline, candidate), /introduced new test failures/);
});

test("candidate validation cannot reduce executed tests or increase skipped tests", () => {
  const baseline = tap({ tests: 3, passed: 3 });
  const fewerTests = tap({ tests: 2, passed: 2 });
  assert.throws(() => assertNoTestRegressions(baseline, fewerTests), /reduced executed tests/);

  const moreSkipped = tap({ tests: 3, passed: 2, skipped: 1 });
  assert.throws(() => assertNoTestRegressions(baseline, moreSkipped), /increased skipped tests/);
});

test("parser rejects incomplete TAP instead of silently accepting an aborted test run", () => {
  assert.throws(() => parseTapResult("TAP version 13\nnot ok 1 - crashed\n"), /summary is missing/);
});

test("autofix workflow compares candidate full tests with the exact unpatched baseline", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/reliability-safe-autofix.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /Capture unpatched baseline full-test result/);
  assert.match(workflow, /reliability-autofix-baseline\.tap/);
  assert.match(workflow, /Apply exact generated patch in credential-free validation job/);
  assert.match(workflow, /Candidate full repository tests must not add failures/);
  assert.match(workflow, /reliability-autofix-test-delta\.mjs/);
  assert.match(workflow, /Production build safety gate/);
});
