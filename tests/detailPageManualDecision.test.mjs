import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canApproveV260807Identity,
  canResumeV260807Checkpoint,
  isV260807DetailPageJob,
  v260807IdentitySnapshot,
  v260807ManualDecisionKind,
  v260807ResumeReason,
} from "../src/lib/detailPageManualDecision.ts";
import { withDetailPageStoreRetry } from "../src/lib/detailPageStoreRetry.ts";

const pageSource = await readFile("src/app/detail-page-ai-review/page.tsx", "utf8");
const queueSource = await readFile(
  "src/components/detail-page-ai-review/DetailPageManualDecisionQueue.tsx",
  "utf8",
);
const routeSource = await readFile(
  "src/app/api/product-launch-tracker/detail-page-jobs/[jobId]/manual-review/route.ts",
  "utf8",
);
const jobsRouteSource = await readFile(
  "src/app/api/product-launch-tracker/detail-page-jobs/route.ts",
  "utf8",
);

function baseJob(overrides = {}) {
  return {
    status: "failed",
    stage: "v3_representative_identity_failed",
    error: "hard silhouette mismatch",
    payload: {
      evidence_urls: [
        "https://assets.example.com/source-1.jpg",
        "https://assets.example.com/source-2.jpg",
      ],
      evidence_names: ["source-1.jpg", "source-2.jpg"],
    },
    result: {
      analysis: { product: { normalized_name: "걸이형 모공브러쉬 블랙" } },
      engineProfile: { id: "source-first-v3" },
      v3Plan: {
        schema_version: "detail_page_v3_plan",
        engine_id: "source-first-v3",
        identity_anchor_index: 0,
      },
      v3Representatives: [
        { roleId: "main_catalog", assetUrl: "https://assets.example.com/main.jpg" },
        { roleId: "alternate_whole", assetUrl: "https://assets.example.com/sub1.jpg" },
        { roleId: "evidence_detail", assetUrl: "https://assets.example.com/sub2.jpg" },
        { roleId: "lifestyle_usage", assetUrl: "https://assets.example.com/sub3.jpg" },
        { roleId: "adaptive_support", assetUrl: "https://assets.example.com/sub4.jpg" },
      ],
      v3RepresentativeIdentityGate: {
        status: "hard_identity_failed_after_retry",
        failedRoleId: "main_catalog",
        reason: "generated item conflicts with authoritative source silhouette",
      },
    },
    ...overrides,
  };
}

test("v260807 identity conflicts are routed to operator judgment without weakening other jobs", () => {
  const current = baseJob();
  assert.equal(isV260807DetailPageJob(current), true);
  assert.equal(v260807ManualDecisionKind(current), "identity_conflict");
  assert.equal(canApproveV260807Identity(current), true);

  const snapshot = v260807IdentitySnapshot(current);
  assert.equal(snapshot?.failedRoleId, "main_catalog");
  assert.equal(snapshot?.anchorIndex, 0);
  assert.equal(snapshot?.anchorUrl, "https://assets.example.com/source-1.jpg");
  assert.equal(snapshot?.failedAssetUrl, "https://assets.example.com/main.jpg");

  assert.equal(
    v260807ManualDecisionKind({
      ...current,
      result: {
        ...current.result,
        v3Plan: {
          ...current.result.v3Plan,
          engine_id: "another-engine",
        },
        engineProfile: { id: "another-engine" },
      },
    }),
    null,
  );
});

test("current auto-recovery exhaustion wins over a stale identity-gate checkpoint", () => {
  const current = baseJob();
  const exhausted = baseJob({
    stage: "v3_parallel_assets_ready",
    error:
      "DETAIL_PAGE_AUTO_RECOVERY_EXHAUSTED: 현재 저장 단계의 안전한 자동 재개 한도를 사용했습니다.",
    payload: {
      ...current.payload,
      recovery_stop_code: "DETAIL_PAGE_AUTO_RECOVERY_EXHAUSTED",
    },
  });
  assert.equal(v260807ResumeReason(exhausted), "auto_recovery_exhausted");
  assert.equal(v260807ManualDecisionKind(exhausted), "resume_checkpoint");
  assert.equal(canResumeV260807Checkpoint(exhausted), true);
});

test("unknown outcome during v260807 representative identity review becomes a human-resumable checkpoint", () => {
  const current = baseJob();
  const unknown = baseJob({
    stage: "v3_representative_identity_review",
    error:
      "DETAIL_PAGE_STEP_OUTCOME_UNKNOWN: AI 단계의 성공 여부를 확인할 수 없어 자동 재결제를 차단했습니다.",
    result: {
      ...current.result,
      v3RepresentativeIdentityGate: {
        status: "manual_anchor_changed",
        failedRoleId: "main_catalog",
      },
    },
  });
  assert.equal(v260807ResumeReason(unknown), "identity_review_outcome_unknown");
  assert.equal(v260807ManualDecisionKind(unknown), "resume_checkpoint");
  assert.equal(canResumeV260807Checkpoint(unknown), true);
});

test("unknown outcome in a paid v260807 generation stage is not automatically exposed as resumable", () => {
  const current = baseJob();
  const unknownGeneration = baseJob({
    stage: "v3_generation",
    error:
      "DETAIL_PAGE_STEP_OUTCOME_UNKNOWN: AI 단계의 성공 여부를 확인할 수 없어 자동 재결제를 차단했습니다.",
    result: {
      ...current.result,
      v3RepresentativeIdentityGate: { status: "passed" },
    },
  });
  assert.equal(v260807ResumeReason(unknownGeneration), null);
  assert.equal(v260807ManualDecisionKind(unknownGeneration), null);
  assert.equal(canResumeV260807Checkpoint(unknownGeneration), false);
});

test("review page exposes the four cost-aware operator choices", () => {
  assert.match(pageSource, /DetailPageManualDecisionQueue/);
  assert.match(queueSource, /저장 지점에서 계속/);
  assert.match(queueSource, /현재 이미지 승인하고 계속/);
  assert.match(queueSource, /문제 이미지만 재생성/);
  assert.match(queueSource, /기준 원본 변경/);
  assert.match(queueSource, /전체 재생성은 마지막 수단/);
  assert.match(queueSource, /현재 작업 1건에만 적용/);
  assert.match(queueSource, /manual-review/);
  assert.match(queueSource, /encodeURIComponent\(job\.jobId\)\}\/start/);
});

test("manual decision API preserves assets and records job-scoped audit decisions", () => {
  assert.match(routeSource, /action === "resume_checkpoint"/);
  assert.match(routeSource, /action === "approve_identity"/);
  assert.match(routeSource, /action === "regenerate_identity_asset"/);
  assert.match(routeSource, /action === "change_identity_anchor"/);
  assert.match(routeSource, /manual_review_decision/);
  assert.match(routeSource, /manual_review_decided_at/);
  assert.match(routeSource, /manual_identity_override: true/);
  assert.match(routeSource, /v3RepresentativeIdentityPassed: true/);
  assert.match(routeSource, /v3Representatives: representatives\.filter/);
  assert.match(routeSource, /identity_anchor_index: nextAnchorIndex/);
  assert.match(routeSource, /v3RepresentativeIdentityRetries: \{\}/);
  assert.match(routeSource, /auto_recovery_count: 0/);
});

test("v260807 manual-review storage reads and writes retry transient 504 timeouts", async () => {
  assert.match(routeSource, /withDetailPageStoreRetry/);
  assert.match(routeSource, /readDetailPageJob\(config\.value, jobId\)/);
  assert.match(routeSource, /patchDetailPageJob\(config\.value, job\.id, patch\)/);

  let attempts = 0;
  const result = await withDetailPageStoreRetry(async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error("상세페이지 작업 저장소 요청에 실패했습니다. status=504");
    }
    return "saved";
  }, 2);
  assert.equal(result, "saved");
  assert.equal(attempts, 2);
});

test("detail-page list polling is de-duplicated briefly and retries statement timeouts", () => {
  assert.match(jobsRouteSource, /JOB_LIST_CACHE_TTL_MS = 1_500/);
  assert.match(jobsRouteSource, /cachedDetailPageJobs/);
  assert.match(jobsRouteSource, /cached\?\.inFlight/);
  assert.match(jobsRouteSource, /withDetailPageStoreRetry/);
  assert.match(jobsRouteSource, /jobListCache\.set/);
});
