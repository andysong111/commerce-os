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

  const [registry, moduleSource, page] = await Promise.all([
    readFile(new URL("../src/lib/opsModuleRegistry.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/reliabilityLearningModule.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/reliability/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(registry, /reliabilityLearningModule/);
  assert.match(moduleSource, /route: "\/reliability"/);
  assert.match(moduleSource, /고위험 자동수정 차단/);
  assert.match(page, /통합 신뢰성·자기개선 코어/);
  assert.match(page, /원문 입력·고객 이메일·이미지는 저장하지 않음/);
});
