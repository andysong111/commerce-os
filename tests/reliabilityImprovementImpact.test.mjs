import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

test("학습사례는 실제 정책·커밋이 확인된 경우에만 반영 상태가 된다", async () => {
  const migration = await source(
    "supabase/migrations/202608241000_reliability_improvement_ledger.sql",
  );

  assert.match(migration, /create table if not exists public\.reliability_improvements/);
  assert.match(migration, /'analysis_pending','implementation_needed','approval_required','policy_active'/);
  assert.match(
    migration,
    /v_regression\.status in \('implemented','passing'\).*v_regression\.commit_sha/s,
  );
  assert.match(migration, /v_application_mode := 'github_change'/);
  assert.match(migration, /v_application_mode := 'existing_policy'/);
  assert.match(migration, /v_status := 'implementation_needed'/);
  assert.match(migration, /v_incident\.risk_level in \('high','critical'\)/);
  assert.doesNotMatch(migration, /v_status := 'applied';\s*v_application_mode := 'none'/);
});

test("기존 정책이 학습사례보다 오래됐으면 새 개선 효과로 소급 계산하지 않는다", async () => {
  const [guard, dashboard] = await Promise.all([
    source(
      "supabase/migrations/202608241002_reliability_existing_policy_baseline_guard.sql",
    ),
    source("src/lib/reliability/reliabilityDashboard.ts"),
  ]);

  assert.match(guard, /v_policy_created_at < v_learning_created_at/);
  assert.match(guard, /new\.applied_at := null/);
  assert.match(guard, /new\.measurement_result := 'not_started'/);
  assert.match(guard, /measurementBaselineAvailable/);
  assert.match(
    guard,
    /revoke all on function public\.guard_reliability_improvement_measurement_baseline\(\)/,
  );
  assert.match(
    dashboard,
    /\.eq\("application_mode", "existing_policy"\),/,
  );
  assert.doesNotMatch(
    dashboard,
    /\.eq\("application_mode", "existing_policy"\)\s*\.not\("applied_at"/,
  );
});

test("효과 측정은 정확히 연결된 사건과 고유 실행만 비교한다", async () => {
  const hardening = await source(
    "supabase/migrations/202608241003_reliability_improvement_evidence_scope_hardening.sql",
  );

  assert.match(hardening, /count\(distinct coalesce\(e\.run_id, e\.id::text\)\)/);
  assert.match(hardening, /e\.incident_id = r\.incident_id/);
  assert.match(hardening, /v_baseline_start := r\.applied_at - v_duration/);
  assert.match(hardening, /v_current_start := r\.applied_at/);
  assert.match(hardening, /v_baseline_events < 5/);
  assert.match(hardening, /v_current_events < 5/);
  assert.match(hardening, /v_improvement_percent >= 20/);
  assert.match(hardening, /v_improvement_percent <= -20/);
  assert.match(hardening, /v_measurement_result := 'insufficient_data'/);
  assert.match(
    hardening,
    /linked incident failures per distinct engine run before versus after application/,
  );
  assert.match(
    hardening,
    /revoke all on function public\.refresh_reliability_improvement_measurements\(\)/,
  );
});

test("정책·커밋 근거가 사라지면 반영·측정 흔적을 모두 제거한다", async () => {
  const [scopeHardening, cleanup] = await Promise.all([
    source(
      "supabase/migrations/202608241003_reliability_improvement_evidence_scope_hardening.sql",
    ),
    source(
      "supabase/migrations/202608241004_reliability_stale_application_cleanup.sql",
    ),
  ]);

  assert.match(scopeHardening, /v_policy_enabled/);
  assert.match(scopeHardening, /v_regression_qualifies/);
  assert.match(scopeHardening, /new\.application_mode := 'none'/);
  assert.match(scopeHardening, /new\.applied_at := null/);
  assert.match(cleanup, /old\.application_mode in/);
  assert.match(cleanup, /old\.status in \('applied','measuring','verified','neutral','regressed'\)/);
  assert.match(cleanup, /applicationEvidenceActive', false/);
  assert.match(cleanup, /new\.measurement_result := 'not_started'/);
  assert.match(cleanup, /new\.improvement_percent := null/);
  assert.match(
    cleanup,
    /revoke all on function public\.clear_stale_reliability_application_evidence\(\)/,
  );
});

test("운영 Cron은 학습 분석 뒤에 개선 효과를 best-effort로 갱신한다", async () => {
  const [route, evaluator] = await Promise.all([
    source("src/app/api/cron/product-decision-live-refresh/route.ts"),
    source("src/lib/reliability/reliabilityImpactEvaluator.ts"),
  ]);

  assert.match(route, /runReliabilityLearningBestEffort/);
  assert.match(route, /runReliabilityImpactBestEffort/);
  assert.match(route, /const reliabilityLearning = await/);
  assert.match(route, /const reliabilityImpact = await/);
  assert.match(evaluator, /refresh_reliability_improvement_measurements/);
  assert.match(evaluator, /적용된 개선/);
});

test("통제실은 수집·분석·개선안·실제반영·효과검증을 쉬운 문장으로 구분한다", async () => {
  const [page, dashboard] = await Promise.all([
    source("src/app/reliability/page.tsx"),
    source("src/lib/reliability/reliabilityDashboard.ts"),
  ]);

  assert.match(page, /데이터가 실제 개선으로 이어지는 단계/);
  assert.match(page, /자동 수집/);
  assert.match(page, /원인 분석/);
  assert.match(page, /개선안 생성/);
  assert.match(page, /실제 반영/);
  assert.match(page, /효과 검증/);
  assert.match(page, /학습 완료와 실제 반영은 다릅니다/);
  assert.match(page, /실제로 무엇이 바뀌고 있나/);
  assert.match(page, /문제 → 학습 내용 → 반영 방식 → 효과 측정/);
  assert.match(dashboard, /reliability_improvements/);
  assert.match(dashboard, /improvementsApplied/);
  assert.match(dashboard, /improvementsVerified/);
  assert.match(dashboard, /improvementsRegressed/);
});
