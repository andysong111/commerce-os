import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canResumeDetailPageCheckpoint,
  detailPageReviewAssets,
  detailPageReviewBucket,
} from "../src/lib/detailPageAiReview.ts";
import { moduleRegistry } from "../src/lib/moduleRegistry.ts";

const pageSource = await readFile("src/app/detail-page-ai-review/page.tsx", "utf8");
const workspaceSource = await readFile(
  "src/components/detail-page-ai-review/DetailPageAiReviewWorkspace.tsx",
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

function job(overrides = {}) {
  return {
    jobId: "00112233-4455-4677-8899-aabbccddeeff",
    itemId: "launch-2462-aaa492",
    status: "failed",
    stage: "server_generation",
    message: "최종 자산 검수 실패",
    progress: 79,
    qaStatus: "failed",
    attempt: 9,
    error: "alternate_whole identity mismatch",
    payload: {
      product_name: "미니짐볼 300g 색상랜덤",
      evidence_urls: ["https://assets.example.com/evidence-1.jpg"],
      evidence_names: ["identity.jpg"],
    },
    result: {
      analysis: { product: { name: "미니짐볼" } },
      representatives: [
        { roleId: "main_hero", assetUrl: "https://assets.example.com/main.jpg" },
        { roleId: "alternate_whole", assetUrl: "https://assets.example.com/wrong.jpg" },
      ],
      panels: [
        { slot: 1, assetUrl: "https://assets.example.com/wrong-panel.jpg" },
        { slot: 3, assetUrl: "https://assets.example.com/good-panel.jpg" },
      ],
      setAssessment: {
        reason: "alternate_whole and panel 1 are a different electronic product",
        mismatched_panel_slots: [1],
        panel_identity_assessments: [
          { panel_slot: 1, identity_match: false },
          { panel_slot: 3, identity_match: true },
        ],
      },
    },
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T01:00:00.000Z",
    completedAt: "2026-08-02T01:00:00.000Z",
    ...overrides,
  };
}

test("dashboard exposes a dedicated internal detail-page AI review card", () => {
  const module = moduleRegistry.find((item) => item.id === "detail-page-ai-review");
  assert.equal(module?.route, "/detail-page-ai-review");
  assert.equal(module?.historySupport, true);
  assert.match(module?.description ?? "", /문제 이미지/);
  assert.match(pageSource, /상세페이지 AI 작업 검수/);
});

test("review workspace provides overview filters, enlarged evidence, and cost-aware regeneration", () => {
  assert.match(workspaceSource, /검수 필요/);
  assert.match(workspaceSource, /진행 중/);
  assert.match(workspaceSource, /문제 이미지만 재생성/);
  assert.match(workspaceSource, /전체 다시 생성/);
  assert.match(workspaceSource, /1688 원본 참고 이미지/);
  assert.match(workspaceSource, /원본 새 탭 열기/);
  assert.match(workspaceSource, /AI 생성 비용과 처리시간이 다시 발생/);
  assert.match(workspaceSource, /\.\.\.assets\.representatives, \.\.\.assets\.panels/);
  assert.match(workspaceSource, /문제 이미지 \$\{problemAssets\.length\}장만 재생성/);
});

test("failed final-set jobs identify the exact generated problem asset and preserve checkpoint eligibility", () => {
  const failed = job();
  const assets = detailPageReviewAssets(failed);
  assert.equal(detailPageReviewBucket(failed), "needs_review");
  assert.equal(canResumeDetailPageCheckpoint(failed), true);
  assert.equal(assets.representatives.length, 2);
  assert.equal(assets.representatives[0].problem, false);
  assert.equal(assets.representatives[1].roleId, "alternate_whole");
  assert.equal(assets.representatives[1].problem, true);
  assert.equal(assets.panels.length, 2);
  assert.equal(assets.panels[0].roleId, "panel-1");
  assert.equal(assets.panels[0].problem, true);
  assert.equal(assets.panels[1].roleId, "panel-3");
  assert.equal(assets.panels[1].problem, false);
  assert.equal(assets.evidence.length, 1);
});

test("review requests target an exact checkpoint or explicitly force a full regeneration", () => {
  assert.match(dockSource, /requestedJobId/);
  assert.match(dockSource, /options\.mode === "full" \? null/);
  assert.match(dockSource, /candidate\.jobId === options\.requestedJobId/);
  assert.match(dockSource, /전체 재생성을 별도로 선택하세요/);
  assert.match(dockSource, /commerce-os-detail-page-ai-review/);
  assert.match(dockSource, /문제 자산만 이어서 생성합니다/);
  assert.match(jobRouteSource, /panelRetrySlots: \[\]/);
  assert.match(jobRouteSource, /panelRetryInstructions: \{\}/);
});
