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

test("worker keeps missing, alias-incompatible, required-harness, malformed anchor, and syntax revisions bounded", async () => {
  const [worker, route, openai] = await Promise.all([
    source("scripts/reliability-autofix-worker.mjs"),
    source("src/app/api/integrations/reliability/autofix/route.ts"),
    source("src/lib/reliability/reliabilityAutofixOpenAi.ts"),
  ]);

  assert.match(worker, /class MissingExecutedRegressionTestError extends Error/);
  assert.match(worker, /class IncompatibleExecutedRegressionTestError extends Error/);
  assert.match(worker, /class RequiredExistingHarnessError extends Error/);
  assert.match(worker, /class EditAnchorMismatchError extends Error/);
  assert.match(worker, /class InvalidExecutedRegressionTestSyntaxError extends Error/);
  assert.match(worker, /this\.targetPath = targetPath/);
  assert.match(worker, /this\.requiredPaths = required/);
  assert.match(worker, /this\.proposedPaths = proposed/);
  assert.match(worker, /this\.occurrences = occurrences/);
  assert.match(worker, /this\.detail = detail/);
  assert.match(worker, /function directTypeScriptImports\(source\)/);
  assert.match(worker, /function sourceUsesUnresolvedAlias\(path\)/);
  assert.match(worker, /function enrichContextWithExistingHarness\(context, targetPath\)/);
  assert.match(worker, /function enrichContextWithAnchorFile\(context, path\)/);
  assert.match(worker, /function assertExecutableTestSyntax\(planned\)/);
  assert.match(worker, /execFileSync\(process\.execPath, \["--check", tempPath\]/);
  assert.match(worker, /assertExecutedTestHarnessCompatible\(proposalPath\(edit\), String\(edit\?\.new_text \?\? ""\)\)/);
  assert.match(worker, /assertExecutableTestSyntax\(planned\)/);
  assert.match(worker, /error instanceof MissingExecutedRegressionTestError/);
  assert.match(worker, /error instanceof IncompatibleExecutedRegressionTestError/);
  assert.match(worker, /error instanceof RequiredExistingHarnessError/);
  assert.match(worker, /error instanceof EditAnchorMismatchError/);
  assert.match(worker, /error instanceof InvalidExecutedRegressionTestSyntaxError/);
  assert.match(worker, /INCOMPATIBLE_TEST_HARNESS_REVISION_FEEDBACK/);
  assert.match(worker, /REQUIRED_EXISTING_HARNESS_REVISION_FEEDBACK/);
  assert.match(worker, /EDIT_ANCHOR_MISMATCH_REVISION_FEEDBACK/);
  assert.match(worker, /INVALID_EXECUTED_TEST_SYNTAX_REVISION_FEEDBACK/);
  assert.match(worker, /허용 실행 테스트 경로/);
  assert.match(worker, /검출된 anchor 오류/);
  assert.match(worker, /검출된 구문 오류/);
  assert.match(worker, /files:revisionContext/);
  assert.match(worker, /changed=applyProposal\(proposal,revisionContext,requiredTestPaths\)/);
  assert.match(worker, /revision_feedback: revisionFeedback|revision_feedback:revisionFeedback/);
  assert.match(worker, /preflightProposal\(edits, requiredTestPaths\)/);
  assert.match(worker, /if \(!executedTestPaths\.length\) throw new MissingExecutedRegressionTestError\(\)/);
  assert.match(worker, /throw new RequiredExistingHarnessError\(required, executedTestPaths\)/);
  assert.match(worker, /const occurrences = countOccurrences\(state\.current, oldText\)/);
  assert.match(worker, /throw new EditAnchorMismatchError\(path, occurrences\)/);
  assert.match(worker, /const MAX_GENERATION_REVISIONS = 2;/);
  assert.match(worker, /for \(let revision=0; revision<=MAX_GENERATION_REVISIONS; revision\+=1\)/);
  assert.doesNotMatch(worker, /while\s*\([^)]*revision/i);
  assert.match(worker, /requiredTestPaths=next\.requiredTestPaths/);
  assert.match(route, /text\(body\.revision_feedback, 1_000\)/);
  assert.match(openai, /buildReliabilityAutofixPrompt\(job, files, revisionFeedback\)/);
});

test("alias harness guard covers the Shopling failure shape from the closed-loop runs", async () => {
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
  assert.match(worker, /walk\(join\(ROOT, "tests"\)\)/);
  assert.match(worker, /contentReferencesHarnessTarget/);
  assert.match(worker, /if \(enriched\.harnessPaths\.length\) nextRequiredTestPaths=enriched\.harnessPaths/);
  assert.match(worker, /const allowed = new Set\(required\)/);
  assert.match(worker, /hasUnexpected = executedTestPaths\.some\(\(path\) => !allowed\.has\(path\)\)/);
  assert.match(worker, /목록 밖 테스트 파일을 새로 만들거나 수정하지 마세요/);
  assert.match(worker, /provided existing.*transpile\/load|기존 실행 테스트.*transpile\/load/i);
});

test("exact edit anchor failures stay bounded and preserve the original trusted file first", async () => {
  const worker = await source("scripts/reliability-autofix-worker.mjs");

  assert.match(worker, /Proposal old_text must match exactly once in the trusted repository file/);
  assert.match(worker, /push\(normalized, readFileSync\(absolute, "utf8"\)\)/);
  assert.match(worker, /old_text가 제공된 최신 저장소 파일에서 정확히 한 번 일치하지 않았습니다/);
  assert.match(worker, /동일한 저위험 수정 범위 안에서 완전한 대체 제안/);
});

test("generated executable JavaScript tests receive a parser preflight before repository tests", async () => {
  const worker = await source("scripts/reliability-autofix-worker.mjs");

  assert.match(worker, /Executable regression test is not valid JavaScript syntax/);
  assert.match(worker, /Node 구문 검사에서 실패했습니다/);
  assert.match(worker, /중첩 template literal\/backtick/);
  assert.match(worker, /mkdtempSync\(join\(tmpdir\(\), "commerce-os-autofix-syntax-"\)\)/);
  assert.match(worker, /writeFileSync\(tempPath, state\.current, "utf8"\)/);
  assert.match(worker, /execFileSync\(process\.execPath, \["--check", tempPath\]/);
  assert.match(worker, /rmSync\(tempRoot, \{ recursive: true, force: true \}\)/);
  assert.match(worker, /revisionContext=enrichContextWithAnchorFile\(context,error\.path\)/);
});
