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

test("worker retries exactly once only for the missing-regression-test validator error", async () => {
  const [worker, route, openai] = await Promise.all([
    source("scripts/reliability-autofix-worker.mjs"),
    source("src/app/api/integrations/reliability/autofix/route.ts"),
    source("src/lib/reliability/reliabilityAutofixOpenAi.ts"),
  ]);

  assert.match(worker, /class MissingExecutedRegressionTestError extends Error/);
  assert.match(worker, /if \(!\(error instanceof MissingExecutedRegressionTestError\)\) throw error/);
  assert.match(worker, /revision_feedback:REGRESSION_TEST_REVISION_FEEDBACK/);
  assert.match(worker, /preflightProposal\(edits\)/);
  assert.match(worker, /if \(!executedTestProposed\) throw new MissingExecutedRegressionTestError\(\)/);
  assert.doesNotMatch(worker, /for\s*\([^)]*revision/i);
  assert.doesNotMatch(worker, /while\s*\([^)]*revision/i);
  assert.match(route, /text\(body\.revision_feedback, 1_000\)/);
  assert.match(openai, /buildReliabilityAutofixPrompt\(job, files, revisionFeedback\)/);
});
