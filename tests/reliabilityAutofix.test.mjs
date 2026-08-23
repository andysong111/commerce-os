import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertAutofixJobEligible,
  isAutofixSafePath,
  parseReliabilityAutofixProposal,
} from "../src/lib/reliability/reliabilityAutofixPolicy.ts";

const ROOT = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, ROOT), "utf8");

function eligibleJob(overrides = {}) {
  return {
    job_id: "11111111-1111-4111-8111-111111111111",
    improvement_id: "22222222-2222-4222-8222-222222222222",
    incident_id: "33333333-3333-4333-8333-333333333333",
    target_repo: "andysong111/commerce-os-ops-center",
    engine: "safe-engine",
    error_code: "transient_failure",
    title: "safe retry",
    fact_summary: "일시적 외부 실패",
    root_cause: "외부 호출 일시 실패",
    change_summary: "제한된 재시도",
    prevention_rule: "최대 세 번만 재시도",
    expected_effect: "일시 오류 감소",
    improvement_kind: "retry_policy",
    safe_action: "retry",
    risk_level: "low",
    confidence: 0.7,
    target_test_name: "retry is bounded",
    protected_invariant: "business writes are unchanged",
    occurrence_count: 3,
    ...overrides,
  };
}

test("자동수정은 일반 로직·테스트만 허용하고 고위험 업무 경로는 차단한다", () => {
  assert.equal(isAutofixSafePath("src/lib/safeExternalRetry.ts"), true);
  assert.equal(isAutofixSafePath("tests/safeExternalRetry.test.mjs"), true);
  assert.equal(isAutofixSafePath("src/lib/priceAdjustment.ts"), false);
  assert.equal(isAutofixSafePath("src/lib/inventoryWorker.ts"), false);
  assert.equal(isAutofixSafePath("src/app/api/auth/callback/route.ts"), false);
  assert.equal(isAutofixSafePath("supabase/migrations/anything.sql"), false);
  assert.equal(isAutofixSafePath(".github/workflows/ci.yml"), false);
  assert.equal(isAutofixSafePath("vercel.json"), false);
  assert.equal(isAutofixSafePath("../escape.ts"), false);
});

test("자동수정 후보는 낮은 위험·충분한 신뢰도·명시적 안전 행동만 통과한다", () => {
  assert.doesNotThrow(() => assertAutofixJobEligible(eligibleJob()));
  assert.throws(() => assertAutofixJobEligible(eligibleJob({ risk_level: "medium" })), /낮은 위험/);
  assert.throws(() => assertAutofixJobEligible(eligibleJob({ confidence: 0.64 })), /신뢰도/);
  assert.throws(() => assertAutofixJobEligible(eligibleJob({ safe_action: "none" })), /안전한 자동행동/);
  assert.throws(
    () => assertAutofixJobEligible(eligibleJob({ improvement_kind: "code_change" })),
    /허용 범위/,
  );
});

test("AI 제안도 경로 안전 경계를 다시 통과해야 하고 새 소스 파일 생성은 금지된다", () => {
  const proposal = parseReliabilityAutofixProposal({
    summary: "bounded retry",
    reasoning: "transient failure only",
    validation_notes: "run regression",
    edits: [
      {
        path: "src/lib/safeExternalRetry.ts",
        old_text: "return fetch(url);",
        new_text: "return retryFetch(url);",
      },
      {
        path: "tests/safeExternalRetry.test.mjs",
        old_text: "",
        new_text: "import test from 'node:test';\n",
      },
    ],
  });
  assert.equal(proposal.edits.length, 2);

  assert.throws(
    () =>
      parseReliabilityAutofixProposal({
        summary: "unsafe",
        reasoning: "unsafe",
        validation_notes: "none",
        edits: [{ path: "src/lib/inventoryWorker.ts", old_text: "a", new_text: "b" }],
      }),
    /금지 경로/,
  );
  assert.throws(
    () =>
      parseReliabilityAutofixProposal({
        summary: "new source",
        reasoning: "unsafe",
        validation_notes: "none",
        edits: [{ path: "src/lib/newHelper.ts", old_text: "", new_text: "export {}" }],
      }),
    /테스트 파일/,
  );
});

test("DB queue는 저위험 후보만 자동 등록하고 service-role로 잠긴다", async () => {
  const migration = await source(
    "supabase/migrations/202608241100_reliability_autofix_queue.sql",
  );
  assert.match(migration, /i\.risk_level = 'low'/);
  assert.match(migration, /i\.confidence >= 0\.65/);
  assert.match(migration, /i\.safe_action in \('retry','resume_checkpoint','revalidate','quarantine'\)/);
  assert.match(migration, /for update of j skip locked/);
  assert.match(migration, /interval '45 minutes'/);
  assert.match(migration, /attempts < j\.max_attempts/);
  assert.match(migration, /revoke all on table public\.reliability_autofix_jobs from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.claim_reliability_autofix_job\(text,text\) to service_role/);
});

test("GitHub Worker는 장기 비밀키 없이 OIDC·CI·Preview를 통과한 경우만 자동 병합한다", async () => {
  const [workflow, oidc, route, worker] = await Promise.all([
    source(".github/workflows/reliability-safe-autofix.yml"),
    source("src/lib/reliability/reliabilityGithubOidc.ts"),
    source("src/app/api/integrations/reliability/autofix/route.ts"),
    source("scripts/reliability-autofix-worker.mjs"),
  ]);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /pull-requests: write/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /Production build safety gate/);
  assert.match(workflow, /Wait for independent CI and Vercel Preview/);
  assert.match(workflow, /Confirm Production deployment/);
  assert.doesNotMatch(workflow, /secrets\.OPENAI_API_KEY/);
  assert.doesNotMatch(workflow, /secrets\.SUPABASE/);
  assert.match(oidc, /commerce-os-reliability-autofix/);
  assert.match(oidc, /refs\/heads\/main/);
  assert.match(oidc, /Reliability Safe Autofix/);
  assert.match(route, /verifyReliabilityGithubOidc/);
  assert.match(route, /loadClaimedJob/);
  assert.match(worker, /Source autofix must include a regression test change/);
  assert.match(worker, /changed\.length > 4 \|\| lineBudget > 260/);
});

test("AI 자동수정 프롬프트는 업무 핵심 쓰기와 검증 약화를 명시적으로 금지한다", async () => {
  const policy = await source("src/lib/reliability/reliabilityAutofixPolicy.ts");
  assert.match(policy, /가격, 재고, 발주, 주문, 결제, 크레딧, 인증, 권한, 비밀키, DB 스키마/);
  assert.match(policy, /테스트를 삭제\/skip하지 않는다/);
  assert.match(policy, /새 외부 의존성을 추가하지 않는다/);
  assert.match(policy, /회귀 테스트를 함께 추가/);
});
