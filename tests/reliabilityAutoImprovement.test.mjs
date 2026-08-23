import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, ROOT), "utf8");

test("자동수정은 등록된 저위험 SERVER_FINALIZATION_FAILED만 첫 안전구역으로 허용한다", async () => {
  const [migration, policy] = await Promise.all([
    source("supabase/migrations/202608241100_reliability_auto_improvement_jobs.sql"),
    source("src/lib/reliability/reliabilityAutoImprovementPolicy.ts"),
  ]);
  assert.match(migration, /SERVER_FINALIZATION_FAILED/);
  assert.match(migration, /v\.risk_level = 'low'/);
  assert.match(migration, /v\.confidence >= 0\.60/);
  assert.match(migration, /v\.safe_action = 'retry'/);
  assert.match(migration, /v_mode := 'approval'/);
  assert.match(migration, /v_mode := 'blocked'/);
  assert.match(policy, /ai_saurus_server_finalization_retry_v1/);
  assert.match(policy, /saasServerFinalizerRetry\.test\.ts/);
  for (const forbidden of ["supabase/migrations/", "vercel.json", "billing", "payment", "inventory"]) {
    assert.match(policy, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("GitHub 실행기는 OIDC 서명과 저장소·main·정확한 workflow를 모두 확인한다", async () => {
  const oidc = await source("src/lib/reliability/reliabilityGitHubOidc.ts");
  assert.match(oidc, /token\.actions\.githubusercontent\.com/);
  assert.match(oidc, /RSA-SHA256/);
  assert.match(oidc, /commerce-os-reliability-auto-improvement/);
  assert.match(oidc, /workflow_ref/);
  assert.match(oidc, /refs\/heads\/main/);
  assert.match(oidc, /commerce-os-detail-page-saas/);
  assert.match(oidc, /commerce-os-ops-center/);
  assert.doesNotMatch(oidc, /GITHUB_TOKEN/);
});

test("계획기는 AI가 허용 파일 밖·새 운영파일·비밀정보·테스트 없는 수정을 만들면 차단한다", async () => {
  const planner = await source("src/lib/reliability/reliabilityAutoImprovementPlanner.ts");
  assert.match(planner, /validateReliabilityAutoImprovementPaths/);
  assert.match(planner, /새로운 운영 코드 파일을 만들 수 없습니다/);
  assert.match(planner, /재발 방지 테스트가 포함되지 않았습니다/);
  assert.match(planner, /BEGIN PRIVATE KEY/);
  assert.match(planner, /requireSaasUser\(request\)/);
  assert.match(planner, /FINALIZER_QUALITY_NOT_READY/);
  assert.match(planner, /FINALIZER_CHECKPOINT_NOT_READY/);
  assert.match(planner, /requestReliabilityStructuredJson/);
});

test("저장소 worker는 서버와 별개로 경로·원본 SHA·diff·재발방지 테스트를 다시 검증한다", async () => {
  const worker = await source("scripts/reliability-auto-improvement-worker.mjs");
  assert.match(worker, /GITHUB_REPOSITORY/);
  assert.match(worker, /git\("hash-object", path\)/);
  assert.match(worker, /git", \["diff", "--check"\]/);
  assert.match(worker, /requiredTest/);
  assert.match(worker, /계획에 없던 파일 변경/);
  assert.match(worker, /BEGIN PRIVATE KEY/);
  assert.match(worker, /supabase\/migrations\//);
});

test("자동개선 API는 GitHub OIDC 후에만 claim/report를 처리하고 Production 검증 커밋만 반영 근거로 승격한다", async () => {
  const [claim, report, store, writeRpcs] = await Promise.all([
    source("src/app/api/integrations/reliability/auto-improvement/claim/route.ts"),
    source("src/app/api/integrations/reliability/auto-improvement/report/route.ts"),
    source("src/lib/reliability/reliabilityAutoImprovementStore.ts"),
    source("supabase/migrations/202608241101_reliability_auto_improvement_write_rpcs.sql"),
  ]);
  assert.match(claim, /authorizeReliabilityGitHubRunner\(request\)/);
  assert.match(claim, /planReliabilityAutoImprovement/);
  assert.match(report, /authorizeReliabilityGitHubRunner\(request\)/);
  assert.match(report, /production_verified/);
  assert.match(store, /finalize_reliability_auto_improvement_regression/);
  assert.match(store, /p_merge_sha: input\.mergeSha/);
  assert.match(writeRpcs, /status='implemented'/);
  assert.match(writeRpcs, /commit_sha=left\(btrim\(p_merge_sha\),80\)/);
  assert.match(writeRpcs, /Reliability Auto Improvement Validate/);
  assert.match(writeRpcs, /productionVerifiedAt/);
});

test("자동수정 큐와 쓰기 RPC는 service-role 밖에서 실행할 수 없다", async () => {
  const [queueMigration, writeRpcs] = await Promise.all([
    source("supabase/migrations/202608241100_reliability_auto_improvement_jobs.sql"),
    source("supabase/migrations/202608241101_reliability_auto_improvement_write_rpcs.sql"),
  ]);
  assert.match(queueMigration, /enable row level security/);
  assert.match(queueMigration, /revoke all on table public\.reliability_auto_improvement_jobs from public, anon, authenticated/);
  assert.match(queueMigration, /revoke all on function public\.claim_reliability_auto_improvement_job\(text,text\)/);
  assert.match(queueMigration, /grant execute on function public\.claim_reliability_auto_improvement_job\(text,text\) to service_role/);
  assert.match(writeRpcs, /revoke all on function public\.save_reliability_auto_improvement_plan/);
  assert.match(writeRpcs, /grant execute on function public\.finalize_reliability_auto_improvement_regression/);
});
