import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DETAIL_PAGE_STAGED_PIPELINE_VERSION,
  detailPageRecoveryDecision,
  matchesDetailPageExecution,
  restoreManualRegenerationAssetsOnFailure,
} from "../src/lib/detailPageJobRecovery.ts";

const cronRoute = readFileSync(
  new URL("../src/app/api/cron/detail-page-jobs/route.ts", import.meta.url),
  "utf8",
);
const jobRoute = readFileSync(
  new URL(
    "../src/app/api/product-launch-tracker/detail-page-jobs/[jobId]/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const assetRoute = readFileSync(
  new URL(
    "../src/app/api/product-launch-tracker/detail-page-assets/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const startRoute = readFileSync(
  new URL(
    "../src/app/api/product-launch-tracker/detail-page-jobs/[jobId]/start/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("legacy stalled detail-page work is stopped without another AI dispatch", () => {
  assert.deepEqual(
    detailPageRecoveryDecision({
      status: "running",
      stage: "representative_images",
      lease_owner: "old-worker",
      payload: {},
    }),
    {
      action: "fail",
      code: "DETAIL_PAGE_LEGACY_STALLED_STOPPED",
      message:
        "이전 방식에서 정체된 작업을 비용 보호를 위해 중단했습니다. 저장 체크포인트에서 부분 재생성을 다시 시작할 수 있습니다.",
    },
  );
});

test("an unknown paid step outcome never triggers an automatic duplicate call", () => {
  const decision = detailPageRecoveryDecision({
    status: "running",
    stage: "asset_candidate_generation",
    lease_owner: "worker-1",
    payload: { pipeline_version: DETAIL_PAGE_STAGED_PIPELINE_VERSION },
  });
  assert.equal(decision.action, "fail");
  assert.equal(decision.code, "DETAIL_PAGE_STEP_OUTCOME_UNKNOWN");
});

test("stored-candidate QA can be repeated once without another image generation", () => {
  assert.deepEqual(
    detailPageRecoveryDecision({
      status: "running",
      stage: "asset_candidate_qa",
      lease_owner: "expired-worker",
      payload: {
        pipeline_version: DETAIL_PAGE_STAGED_PIPELINE_VERSION,
        auto_recovery_count: 0,
      },
      result: {
        assetWork: {
          phase: "qa_running",
          candidateUrl: "https://assets.example/candidate.jpg",
        },
      },
    }),
    { action: "dispatch", nextRecoveryCount: 1 },
  );
});

test("a checkpointed staged job gets at most one safe automatic redispatch", () => {
  assert.deepEqual(
    detailPageRecoveryDecision({
      status: "running",
      stage: "asset_candidate_qa",
      lease_owner: "",
      payload: {
        pipeline_version: DETAIL_PAGE_STAGED_PIPELINE_VERSION,
        auto_recovery_count: 0,
      },
    }),
    { action: "dispatch", nextRecoveryCount: 1 },
  );
  const exhausted = detailPageRecoveryDecision({
    status: "running",
    stage: "asset_candidate_qa",
    lease_owner: "",
    payload: {
      pipeline_version: DETAIL_PAGE_STAGED_PIPELINE_VERSION,
      auto_recovery_count: 1,
    },
  });
  assert.equal(exhausted.action, "fail");
  assert.equal(exhausted.code, "DETAIL_PAGE_AUTO_RECOVERY_EXHAUSTED");
});

test("failed manual regeneration restores every previously published asset", () => {
  const restored = restoreManualRegenerationAssetsOnFailure({
    assetWork: { phase: "generation_running" },
    representatives: [{ roleId: "main_catalog" }],
    manualRegenerationBackup: {
      representatives: [
        { roleId: "main_catalog" },
        { roleId: "alternate_whole" },
      ],
      panels: [{ slot: 1 }],
      detailImageUrl: "https://assets.example/detail-old.jpg",
      mainImageUrl: "https://assets.example/main-old.jpg",
      additionalImageUrls: ["https://assets.example/additional-old.jpg"],
    },
  });
  assert.equal(restored.assetWork, null);
  assert.deepEqual(restored.lastAssetWork, { phase: "generation_running" });
  assert.equal(restored.representatives.length, 2);
  assert.equal(
    restored.detailImageUrl,
    "https://assets.example/detail-old.jpg",
  );
});

test("staged callbacks are fenced to the exact execution", () => {
  const job = {
    payload: {
      pipeline_version: DETAIL_PAGE_STAGED_PIPELINE_VERSION,
      execution_id: "2d32285c-a624-444f-81b7-1eab2e567fb8",
    },
  };
  assert.equal(
    matchesDetailPageExecution(job, "2d32285c-a624-444f-81b7-1eab2e567fb8"),
    true,
  );
  assert.equal(matchesDetailPageExecution(job, ""), false);
  assert.equal(
    matchesDetailPageExecution(job, "e86fb507-c583-4844-a731-e76f53159954"),
    false,
  );
  assert.equal(matchesDetailPageExecution({ payload: {} }, ""), true);
});

test("a late legacy callback can restore missing representative records from published URLs", () => {
  const restored = restoreManualRegenerationAssetsOnFailure({
    representatives: [
      { roleId: "main_catalog", assetUrl: "https://assets.example/main.jpg" },
      { roleId: "evidence_detail", assetUrl: "https://assets.example/additional-2.jpg" },
      { roleId: "adaptive_support", assetUrl: "https://assets.example/additional-4.jpg" },
    ],
    panels: [{ slot: 1 }],
    mainImageUrl: "https://assets.example/main.jpg",
    additionalImageUrls: [
      "https://assets.example/additional-1.jpg",
      "https://assets.example/additional-2.jpg",
      "https://assets.example/additional-3.jpg",
      "https://assets.example/additional-4.jpg",
    ],
  });
  assert.deepEqual(
    restored.representatives.map((item) => item.roleId),
    [
      "main_catalog",
      "alternate_whole",
      "evidence_detail",
      "lifestyle_usage",
      "adaptive_support",
    ],
  );
  assert.equal(restored.representatives[1].restoredFromPublishedAsset, true);
  assert.equal(
    restored.representatives[1].assetUrl,
    "https://assets.example/additional-1.jpg",
  );
});

test("staged execution metadata, immutable candidate uploads, and the watchdog are wired", () => {
  assert.match(jobRoute, /freshStagedExecution\(restartedAt\)/);
  assert.match(jobRoute, /started_at: restartedAt/);
  assert.match(jobRoute, /manualRegenerationBackup/);
  assert.match(jobRoute, /restoreManualRegenerationAssetsOnFailure/);
  assert.match(assetRoute, /REVISION_PATTERN/);
  assert.match(assetRoute, /`\$\{role\}-\$\{revision\}\.jpg`/);
  assert.match(assetRoute, /DETAIL_PAGE_EXECUTION_STALE/);
  assert.match(assetRoute, /DETAIL_PAGE_JOB_TERMINAL/);
  assert.match(jobRoute, /matchesDetailPageExecution\(job, body\.executionId\)/);
  assert.match(jobRoute, /DETAIL_PAGE_JOB_TERMINAL/);
  assert.match(startRoute, /executionId: String\(runnableJob\.payload\.execution_id/);
  assert.match(cronRoute, /detailPageRecoveryDecision\(job\)/);
  assert.match(cronRoute, /executionId: String\(job\.payload\.execution_id/);
  assert.match(cronRoute, /listStoppedDetailPageJobsForAssetRepair/);
  assert.match(cronRoute, /recovery_assets_repaired_at/);
  assert.match(cronRoute, /stopped unsafe stale job/);
});
