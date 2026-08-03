import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspaceSource = await readFile(
  "src/components/detail-page-ai-review/DetailPageAiReviewWorkspace.tsx",
  "utf8",
);
const trackerEntrySource = await readFile(
  "public/product-launch-tracker-app/app.js",
  "utf8",
);
const dockSource = await readFile(
  "public/product-launch-tracker-app/detail-page-dock.js",
  "utf8",
);
const jobRouteSource = await readFile(
  "src/app/api/product-launch-tracker/detail-page-jobs/[jobId]/route.ts",
  "utf8",
);

test("detail-page review shows a live job progress monitor", () => {
  assert.match(workspaceSource, /상세페이지 작업 현황/);
  assert.match(workspaceSource, /최근 heartbeat/);
  assert.match(workspaceSource, /시도 횟수/);
  assert.match(workspaceSource, /job_id: \{job\.jobId\}/);
  assert.match(workspaceSource, /window\.setInterval\(\(\) => void refresh\(true\), POLL_MS\)/);
});

test("a stalled final assembly can reconnect without regenerating assets", () => {
  assert.match(workspaceSource, /job\.status === "render_pending"/);
  assert.match(workspaceSource, /finalizerPhase === "failed" \|\| heartbeatAge >= 30_000/);
  assert.match(workspaceSource, /type: "activate-detail-page-job"/);
  assert.match(workspaceSource, /requestId,/);
  assert.match(workspaceSource, /최종 조립 다시 연결/);
  assert.match(workspaceSource, /1688 재수집·AI 재생성 없이/);
  assert.doesNotMatch(workspaceSource, /reconnectFinalAssembly[\s\S]{0,900}resume_checkpointed_generation/);
  assert.doesNotMatch(workspaceSource, /최종 조립기 재연결 요청을 전달했습니다/);
});

test("the final-assembly worker boots directly and reports actual readiness", () => {
  assert.match(trackerEntrySource, /detailPageMode === "worker"/);
  assert.match(
    trackerEntrySource,
    /detailPageMode === "worker"\)[\s\S]{0,160}await import\("\.\/detail-page-dock\.js"\)/,
  );
  assert.doesNotMatch(
    trackerEntrySource,
    /detailPageMode === "worker"\)[\s\S]{0,160}await import\("\.\/bootstrap\.js"\)/,
  );
  assert.match(trackerEntrySource, /type: "detail-page-worker-ready"/);
  assert.match(trackerEntrySource, /type === "detail-page-worker-ping"/);
  assert.match(workspaceSource, /payload\?\.type === "detail-page-worker-ready"/);
  assert.match(workspaceSource, /type: "detail-page-worker-ping"/);
  assert.doesNotMatch(workspaceSource, /onLoad=\{\(\) => setWorkerReady\(true\)\}/);
});

test("final-assembly reconnect is acknowledged by the real worker and persisted", () => {
  assert.match(workspaceSource, /type === "detail-page-finalizer-status"/);
  assert.match(workspaceSource, /requestId !== finalizerRequestRef\.current/);
  assert.match(workspaceSource, /최종 조립기가 20초 안에 재연결 요청을 확인하지 못했습니다/);
  assert.match(dockSource, /async function activateFinalizerJob/);
  assert.match(
    dockSource,
    /if \(active\?\.jobId === job\.jobId\) finishActive\(\)/,
  );
  assert.match(dockSource, /type: "detail-page-finalizer-status"/);
  assert.match(dockSource, /action: "finalizer_progress"/);
  assert.match(dockSource, /recordFinalizerProgress\("engine_ready"/);
  assert.match(dockSource, /SNAPSHOT_MAX_ATTEMPTS = 5/);
  assert.match(dockSource, /active\.snapshotDeliveryStarted = true/);
  assert.match(dockSource, /type === "ops-dock-finalize-snapshot-ack"/);
  assert.match(dockSource, /snapshotRequestId: current\.snapshotRequestId/);
  assert.match(dockSource, /FINALIZER_SNAPSHOT_ACK_TIMEOUT/);
  assert.match(dockSource, /FINALIZER_SNAPSHOT_PROGRESS_TIMEOUT/);
  assert.match(dockSource, /SNAPSHOT_PROGRESS_TIMEOUT_MS = 10 \* 1000/);
  assert.match(dockSource, /window\.clearTimeout\(activeSnapshotTimer\)/);
  assert.match(dockSource, /window\.clearTimeout\(activeSnapshotProgressTimer\)/);
  assert.match(dockSource, /type === "ops-dock-finalize-progress"/);
  assert.doesNotMatch(dockSource, /recordFinalizerHeartbeat\("snapshot_loading"/);
  assert.match(jobRouteSource, /"finalizer_heartbeat", "finalizer_progress"/);
  assert.match(jobRouteSource, /finalizer_heartbeat_at: heartbeatAt/);
  assert.match(jobRouteSource, /finalizer_started_at: finalizerStartedAt/);
  assert.match(jobRouteSource, /finalizer_attempt: finalizerAttempt/);
  assert.match(jobRouteSource, /finalizer_completed_assets: completedAssets/);
  assert.match(jobRouteSource, /finalizer_error_code: errorCode/);
  assert.match(workspaceSource, /이번 조립 경과/);
  assert.match(workspaceSource, /조립 시도 횟수/);
  assert.match(workspaceSource, /최근 실제 진행/);
  assert.match(workspaceSource, /finalizerPhase === "failed"/);
  assert.match(dockSource, /Number\.POSITIVE_INFINITY/);
});
