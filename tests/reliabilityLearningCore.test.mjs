import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildReliabilityIncidentSignature,
  normalizeReliabilityEvent,
} from "../src/lib/reliability/reliabilityEvent.ts";
import { authorizeReliabilityIngest } from "../src/lib/reliability/reliabilityIngestAuth.ts";

test("반복 오류 서명은 동일 원인에 안정적이고 단계가 달라지면 분리된다", () => {
  const base = {
    sourceSystem: "ai-saurus",
    engine: "detail-page-generation",
    errorCode: "missing_identity_anchor",
    stage: "representative_retry_pending",
    status: "retrying",
  };
  const first = buildReliabilityIncidentSignature(base);
  const second = buildReliabilityIncidentSignature({ ...base });
  const otherStage = buildReliabilityIncidentSignature({
    ...base,
    stage: "detail_panel_retry_pending",
  });

  assert.equal(first, second);
  assert.notEqual(first, otherStage);
  assert.match(first, /^ai-saurus:detail-page-generation:missing_identity_anchor:/);
});

test("고객 식별자·원문 링크·비밀키는 이벤트 저장 전에 제거된다", () => {
  const event = normalizeReliabilityEvent({
    event_id: "ai-saurus:job:123:failed",
    source_system: "ai-saurus",
    engine: "detail-page-generation",
    status: "failed",
    stage: "product_analysis",
    error_code: "validation_error",
    error_message:
      "owner@example.com https://detail.1688.com/offer/123.html Bearer secret-token-value sk-abcdefghijklmnopqrstuvwxyz",
    metadata: {
      ownerEmail: "owner@example.com",
      source_url: "https://detail.1688.com/offer/123.html",
      productName: "비공개 상품명",
      safeMetric: "kept",
      nested: {
        token: "secret-token-value",
        retryReason: "timeout",
      },
    },
  });

  assert.doesNotMatch(event.error_message ?? "", /owner@example\.com/);
  assert.doesNotMatch(event.error_message ?? "", /1688\.com/);
  assert.doesNotMatch(event.error_message ?? "", /secret-token-value/);
  assert.doesNotMatch(event.error_message ?? "", /sk-abcdefghijklmnopqrstuvwxyz/);
  assert.equal(event.metadata.ownerEmail, "[redacted]");
  assert.equal(event.metadata.source_url, "[redacted]");
  assert.equal(event.metadata.productName, "[redacted]");
  assert.equal(event.metadata.safeMetric, "kept");
  assert.deepEqual(event.metadata.nested, {
    token: "[redacted]",
    retryReason: "timeout",
  });
});

test("수집 인증은 설정 누락과 잘못된 비밀키를 닫힌 상태로 차단한다", () => {
  const valid = new Request("https://ops.example/api/integrations/reliability/events", {
    method: "POST",
    headers: { "x-commerce-os-reliability-secret": "correct-secret" },
  });
  const bearer = new Request("https://ops.example/api/integrations/reliability/events", {
    method: "POST",
    headers: { authorization: "Bearer correct-secret" },
  });
  const wrong = new Request("https://ops.example/api/integrations/reliability/events", {
    method: "POST",
    headers: { "x-commerce-os-reliability-secret": "wrong-secret" },
  });

  assert.deepEqual(authorizeReliabilityIngest(valid, "correct-secret"), {
    ok: true,
  });
  assert.deepEqual(authorizeReliabilityIngest(bearer, "correct-secret"), {
    ok: true,
  });
  assert.equal(authorizeReliabilityIngest(wrong, "correct-secret").status, 401);
  assert.equal(authorizeReliabilityIngest(valid, "").status, 503);
});

test("지원하지 않는 상태는 저장하지 않고 기능 카드와 통제실 경로는 영구 등록된다", async () => {
  assert.throws(
    () =>
      normalizeReliabilityEvent({
        source_system: "commerce-os",
        engine: "keyword-engine",
        status: "magically_fixed",
      }),
    /지원하지 않는 신뢰성 이벤트 값/,
  );

  const [registry, moduleSource, page, layout] = await Promise.all([
    readFile(new URL("../src/lib/opsModuleRegistry.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/reliabilityLearningModule.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/reliability/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/reliability/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(registry, /reliabilityLearningModule/);
  assert.match(moduleSource, /route: "\/reliability"/);
  assert.match(moduleSource, /고위험 자동수정 차단/);
  assert.match(page, /통합 신뢰성·자기개선 코어/);
  assert.match(layout, /원문 입력·고객 이메일·이미지는 저장하지 않음/);
});

test("통제실은 인증된 운영자 확인 뒤에만 service-role 데이터 읽기를 시작한다", async () => {
  const dashboard = await readFile(
    new URL("../src/lib/reliability/reliabilityDashboard.ts", import.meta.url),
    "utf8",
  );
  assert.match(dashboard, /getOpsCurrentUser/);
  assert.match(dashboard, /isShoplingPriceAdjustmentOperatorEmail/);
  assert.match(dashboard, /login_required&next=%2Freliability/);
  const authIndex = dashboard.indexOf("const current = await getOpsCurrentUser()");
  const snapshotIndex = dashboard.indexOf("return loadSnapshot();");
  assert.ok(authIndex >= 0 && snapshotIndex > authIndex);
});

test("OPS 자동 브리지는 선택 소스 부재·부분실패·민감 오류를 안전하게 처리한다", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/202608230901_reliability_ops_automatic_bridges.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /when 'partial_failure' then 'failed'/);
  assert.match(migration, /when 'partial' then 'failed'/);
  assert.match(
    migration,
    /to_regclass\('public\.keyword_engine_elon_lab_stage_results'\) is not null/,
  );
  assert.match(migration, /public\.redact_reliability_text/);
  assert.doesNotMatch(
    migration,
    /drop trigger if exists bridge_keyword_stage_to_reliability on public\.keyword_engine_elon_lab_stage_results;\ncreate trigger/,
  );
});

test("recovered 신호는 실패 재발횟수를 올리지 않고 ingest RPC는 service-role 전용이다", async () => {
  const hardening = await readFile(
    new URL(
      "../supabase/migrations/202608231715_reliability_core_security_hardening.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(hardening, /v_status='recovered'/);
  assert.match(hardening, /v_signature is not null and v_failure_like/);
  assert.match(
    hardening,
    /revoke all on function public\.ingest_reliability_event\(jsonb\) from public, anon, authenticated/,
  );
  assert.match(
    hardening,
    /grant execute on function public\.ingest_reliability_event\(jsonb\) to service_role/,
  );
});

test("학습 분석 큐는 service-role 전용이며 중단된 running lease를 회수한다", async () => {
  const hardening = await readFile(
    new URL(
      "../supabase/migrations/202608231716_reliability_queue_and_bridge_hardening.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    hardening,
    /q\.status='running'.*q\.locked_at.*interval '10 minutes'/s,
  );
  assert.match(
    hardening,
    /revoke all on function public\.claim_reliability_learning_analysis\(integer\) from public, anon, authenticated/,
  );
  assert.match(
    hardening,
    /grant execute on function public\.complete_reliability_learning_analysis\(uuid,text,jsonb\) to service_role/,
  );
  assert.match(hardening, /public\.redact_reliability_text/);
});

test("학습 분석은 전용 OpenAI 비용 lane과 기존 staggered cron wakeup을 재사용한다", async () => {
  const [vercelSource, cronRoute, openAiClient, costGuard] = await Promise.all([
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../src/app/api/cron/product-decision-live-refresh/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../src/lib/reliability/reliabilityOpenAiClient.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../scripts/check-openai-cost-attribution.mjs", import.meta.url),
      "utf8",
    ),
  ]);
  const vercel = JSON.parse(vercelSource);
  assert.equal(
    vercel.crons.some((cron) => cron.path === "/api/cron/reliability-learning"),
    false,
  );
  assert.match(cronRoute, /runReliabilityLearningAnalyzer/);
  assert.match(cronRoute, /maxDuration = 120/);
  assert.match(openAiClient, /RELIABILITY_OPENAI_API_KEY/);
  assert.doesNotMatch(openAiClient, /process\.env\.OPENAI_API_KEY/);
  assert.match(costGuard, /reliabilityOpenAiClient/);
  assert.match(costGuard, /RELIABILITY_OPENAI_API_KEY/);
});

test("자기개선 기능카드는 메인 대시보드와 시스템·점검 업무영역에 항상 노출된다", async () => {
  const [dashboardPage, homeCard, workspace] = await Promise.all([
    readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../src/components/dashboard/ReliabilityLearningHomeCard.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../src/lib/opsWorkspace.ts", import.meta.url), "utf8"),
  ]);

  assert.match(dashboardPage, /ReliabilityLearningHomeCard/);
  assert.match(dashboardPage, /!selectedGroupId \? <ReliabilityLearningHomeCard \/>/);
  assert.match(homeCard, /Commerce OS 통합 신뢰성·자기개선 코어/);
  assert.match(homeCard, /href="\/reliability"/);
  assert.match(homeCard, /AI-Saurus 자동 수집/);
  assert.match(workspace, /id: "system-check"[\s\S]*"reliability-learning-core"/);
  assert.match(workspace, /자기개선·신뢰성·학습·회귀/);
});
