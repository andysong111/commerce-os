import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildReliabilityAutofixPrompt, reliabilityAutofixSystemPrompt } from "../src/lib/reliability/reliabilityAutofixPolicy.ts";

const ROOT = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, ROOT), "utf8");

const sampleJob = {
  job_id: "11111111-1111-4111-8111-111111111111",
  improvement_id: "22222222-2222-4222-8222-222222222222",
  incident_id: "33333333-3333-4333-8333-333333333333",
  target_repo: "andysong111/commerce-os-ops-center",
  engine: "SAFE_RETRY_ENGINE",
  error_code: "operation_failed",
  title: "safe retry",
  fact_summary: "temporary failure",
  root_cause: "temporary failure",
  change_summary: "bounded retry",
  prevention_rule: "bounded retry",
  expected_effect: "fewer transient failures",
  improvement_kind: "retry_policy",
  safe_action: "retry",
  risk_level: "low",
  confidence: 0.7,
  target_test_name: "retry remains bounded",
  protected_invariant: "business writes unchanged",
  occurrence_count: 3,
};

test("autofix prompt requires an executable regression test whenever source changes", () => {
  assert.match(reliabilityAutofixSystemPrompt(), /실제 실행 회귀 테스트를 반드시/);
  const parsed = JSON.parse(
    buildReliabilityAutofixPrompt(sampleJob, [
      { path: "src/lib/example.ts", content: "export const value = 1;" },
    ]),
  );
  assert.equal(parsed.safety.executable_regression_test_required_with_source_change, true);
  assert.equal(parsed.revision_feedback, undefined);
});

test("validator feedback is bounded and asks for a complete replacement proposal", () => {
  const parsed = JSON.parse(
    buildReliabilityAutofixPrompt(
      sampleJob,
      [{ path: "src/lib/example.ts", content: "export const value = 1;" }],
      "missing executable regression test",
    ),
  );
  assert.equal(parsed.revision_feedback.trusted_validator_feedback, "missing executable regression test");
  assert.match(parsed.revision_feedback.instruction, /완전한 대체 제안/);
});

test("worker retries exactly once for a missing or alias-incompatible regression harness", async () => {
  const [worker, route, openai] = await Promise.all([
    source("scripts/reliability-autofix-worker.mjs"),
    source("src/app/api/integrations/reliability/autofix/route.ts"),
    source("src/lib/reliability/reliabilityAutofixOpenAi.ts"),
  ]);

  assert.match(worker, /class MissingExecutedRegressionTestError extends Error/);
  assert.match(worker, /class IncompatibleExecutedRegressionTestError extends Error/);
  assert.match(worker, /function directTypeScriptImports\(source\)/);
  assert.match(worker, /function sourceUsesUnresolvedAlias\(path\)/);
  assert.match(worker, /assertExecutedTestHarnessCompatible\(path, newText\)/);
  assert.match(worker, /error instanceof MissingExecutedRegressionTestError/);
  assert.match(worker, /error instanceof IncompatibleExecutedRegressionTestError/);
  assert.match(worker, /INCOMPATIBLE_TEST_HARNESS_REVISION_FEEDBACK/);
  assert.match(worker, /revision_feedback:revisionFeedback/);
  assert.match(worker, /preflightProposal\(edits\)/);
  assert.match(worker, /if \(!executedTestProposed\) throw new MissingExecutedRegressionTestError\(\)/);
  assert.doesNotMatch(worker, /for\s*\([^)]*revision/i);
  assert.doesNotMatch(worker, /while\s*\([^)]*revision/i);
  assert.match(route, /text\(body\.revision_feedback, 1_000\)/);
  assert.match(openai, /buildReliabilityAutofixPrompt\(job, files, revisionFeedback\)/);
});

test("alias harness guard covers the Shopling failure shape from the first closed-loop run", async () => {
  const [worker, shoplingSource, existingHarness] = await Promise.all([
    source("scripts/reliability-autofix-worker.mjs"),
    source("src/lib/shopling/shoplingReadClient.ts"),
    source("tests/shoplingReadClient.test.mjs"),
  ]);

  assert.match(shoplingSource, /from "@\/lib\/shopling\/simpleXml"/);
  assert.match(shoplingSource, /from "@\/lib\/shopling\/shoplingTlsTransport"/);
  assert.match(existingHarness, /loadShoplingClient/);
  assert.match(existingHarness, /transpileModule/);
  assert.match(existingHarness, /replace\(/);
  assert.match(worker, /\.tsx\?/);
  assert.match(worker, /targetPath\.startsWith\("src\/"\)/);
  assert.match(worker, /provided existing.*transpile\/load|기존 실행 테스트.*transpile\/load/i);
});
