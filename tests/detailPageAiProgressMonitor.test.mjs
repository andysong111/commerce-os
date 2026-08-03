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

test("detail-page review shows a live job progress monitor", () => {
  assert.match(workspaceSource, /상세페이지 작업 현황/);
  assert.match(workspaceSource, /최근 heartbeat/);
  assert.match(workspaceSource, /시도 횟수/);
  assert.match(workspaceSource, /job_id: \{job\.jobId\}/);
  assert.match(workspaceSource, /window\.setInterval\(\(\) => void refresh\(true\), POLL_MS\)/);
});

test("a stalled final assembly can reconnect without regenerating assets", () => {
  assert.match(workspaceSource, /job\.status === "render_pending" && heartbeatAge >= 30_000/);
  assert.match(workspaceSource, /type: "activate-detail-page-job"/);
  assert.match(workspaceSource, /최종 조립 다시 연결/);
  assert.match(workspaceSource, /1688 재수집·AI 재생성 없이/);
  assert.doesNotMatch(workspaceSource, /reconnectFinalAssembly[\s\S]{0,900}resume_checkpointed_generation/);
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
