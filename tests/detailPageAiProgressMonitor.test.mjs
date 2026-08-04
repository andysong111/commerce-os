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
const startRouteSource = await readFile(
  "src/app/api/product-launch-tracker/detail-page-jobs/[jobId]/start/route.ts",
  "utf8",
);

test("detail-page review shows live server job progress", () => {
  assert.match(workspaceSource, /상세페이지 작업 현황/);
  assert.match(workspaceSource, /최근 실제 진행/);
  assert.match(workspaceSource, /job_id: \{job\.jobId\}/);
  assert.match(
    workspaceSource,
    /window\.setInterval\(\(\) => void refresh\(true\), POLL_MS\)/,
  );
  assert.match(workspaceSource, /isRecoverableServerFinalAssemblyJob\(job\)/);
  assert.match(workspaceSource, /result\.finalizerCompletedAssets/);
  assert.match(workspaceSource, /서버 14,000px 렌더링/);
});

test("failed and completed finalizers use the server start API without regenerating AI assets", () => {
  assert.match(workspaceSource, /const recoverable = isRecoverableServerFinalAssemblyJob\(job\)/);
  assert.match(workspaceSource, /canReassembleCompletedDetailPageJob\(job\)/);
  assert.match(
    workspaceSource,
    /\$\{JOBS_API\}\/\$\{encodeURIComponent\(job\.jobId\)\}\/start/,
  );
  assert.match(workspaceSource, /서버 최종 조립 다시 시작/);
  assert.match(workspaceSource, /최종 조립만 다시 실행/);
  assert.match(workspaceSource, /reassemble_final_only/);
  assert.match(workspaceSource, /1688 재수집·AI 재생성 없이/);
  assert.match(dockSource, /await startWorker\(renderJob\.jobId\)/);
  assert.doesNotMatch(dockSource, /ops_finalize/);
  assert.doesNotMatch(dockSource, /ops-dock-finalize-snapshot/);
  assert.doesNotMatch(dockSource, /openFinalizer/);
  assert.doesNotMatch(workspaceSource, /detail-page-finalizer-status/);
  assert.match(
    startRouteSource,
    /\["success", "failed", "cancelled"\]\.includes\(job\.status\)/,
  );
});

test("the same-origin worker remains only for collection and full regeneration", () => {
  assert.match(trackerEntrySource, /detailPageMode === "worker"/);
  assert.match(
    trackerEntrySource,
    /detailPageMode === "worker"\)[\s\S]{0,160}await import\("\.\/detail-page-dock\.js"\)/,
  );
  assert.match(trackerEntrySource, /type: "detail-page-worker-ready"/);
  assert.match(workspaceSource, /type: "detail-page-worker-ping"/);
  assert.match(dockSource, /mountFrame\(url, "1688 근거 수집기"\)/);
  assert.doesNotMatch(dockSource, /mountFrame\(url, "상세페이지 최종 조립기"\)/);
});

test("server finalizer progress and completion are worker-authorized", () => {
  assert.match(jobRouteSource, /server_finalizer_progress/);
  assert.match(jobRouteSource, /serverFinalizerProgress \? 99 : 95/);
  assert.match(jobRouteSource, /const finalAssemblyFailure/);
  assert.match(
    jobRouteSource,
    /finalAssemblyFailure[\s\S]*status: "render_pending"[\s\S]*qa_status: "passed"/,
  );
  assert.match(
    jobRouteSource,
    /finalAssemblyFailure[\s\S]*Math\.max\([\s\S]*job\.progress[\s\S]*reportedProgress/,
  );
  assert.match(
    jobRouteSource,
    /clearsStaleStandardFailure[\s\S]*standardFailure: null/,
  );
  assert.match(
    jobRouteSource,
    /if \(!workerAuthorized && !ownerAuthorized\)/,
  );
  assert.match(
    jobRouteSource,
    /finalizerMode: workerAuthorized \? "server-v1"/,
  );
  assert.match(jobRouteSource, /서버 조립 상세 HTML과 이미지 URL 자동 도킹 완료/);
});
