import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canReassembleCompletedDetailPageJob,
  canResumeDetailPageCheckpoint,
  detailPageCheckpointId,
  detailPageFailureCode,
  detailPageProblemReason,
  detailPageReviewAssets,
  detailPageReviewBucket,
  detailPageStageLabel,
  detailPageStandardDiagnostics,
  findDetailPageResumeCandidate,
  hasFullAssetDetailPageAssessment,
  isActiveDetailPageJob,
  isRecoverableServerFinalAssemblyJob,
  standardQualityRetryPlan,
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
const startRouteSource = await readFile(
  "src/app/api/product-launch-tracker/detail-page-jobs/[jobId]/start/route.ts",
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
  const registryModule = moduleRegistry.find(
    (item) => item.id === "detail-page-ai-review",
  );
  assert.equal(registryModule?.route, "/detail-page-ai-review");
  assert.equal(registryModule?.historySupport, true);
  assert.match(registryModule?.description ?? "", /문제 이미지/);
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
  assert.match(workspaceSource, /상세 섹션 전체 검수 이전 기록/);
  assert.match(workspaceSource, /전체 재검수 후 문제 이미지만 재생성/);
  assert.match(workspaceSource, /resume_checkpointed_generation/);
  assert.match(workspaceSource, /encodeURIComponent\(job\.jobId\)\}\/start/);
  assert.match(workspaceSource, /mode === "full" && !workerReady/);
  assert.match(workspaceSource, /1688 재수집 없이 기존 체크포인트/);
  assert.match(workspaceSource, /직전 검수 체크포인트/);
  assert.match(workspaceSource, /캡처용 오류 진단/);
  assert.match(workspaceSource, /Standard-v2 차단 상세 섹션/);
  assert.match(workspaceSource, /실제 점수 \/ 하한/);
  assert.match(workspaceSource, /차단된 상세 섹션 \$\{standardDiagnostics\.length\}장만 재생성/);
  assert.match(workspaceSource, /onRetry=\{onResume\}/);
  assert.match(workspaceSource, /onClick=\{onRetry\}/);
  assert.match(workspaceSource, /aria-label=\{`\$\{item\.label\}만 재생성`\}/);
  assert.doesNotMatch(
    workspaceSource,
    /\{item\.retryable \? "이 섹션만 재생성" : "사용자 검토"\}/,
  );
  assert.match(
    workspaceSource,
    /bucket === "needs_review"\s*\?\s*detailPageStandardDiagnostics\(recoveryJob\)/,
  );
  assert.match(
    jobRouteSource,
    /action === "render_pending"[\s\S]*standardFailure: null/,
  );
  assert.match(workspaceSource, /서버 최종 조립 다시 시작/);
  assert.match(workspaceSource, /최종 조립만 다시 실행/);
  assert.match(workspaceSource, /reassemble_final_only/);
  assert.match(workspaceSource, /AI 재생성 비용은 발생하지 않습니다/);
  assert.match(workspaceSource, /encodeURIComponent\(job\.jobId\)\}\/start/);
  assert.doesNotMatch(dockSource, /async function openFinalizer/);
  assert.doesNotMatch(dockSource, /ops_finalize/);
  assert.match(jobRouteSource, /server_finalizer_progress/);
  assert.match(jobRouteSource, /finalizerMode: workerAuthorized \? "server-v1"/);
});

test("a completed server result can reassemble only the final JPEG from stored approved assets", () => {
  const completed = job({
    status: "success",
    stage: "docked",
    qaStatus: "passed",
    error: "",
    result: {
      ...job().result,
      setAssessment: {
        ...job().result.setAssessment,
        status: "passed",
      },
      representatives: Array.from({ length: 5 }, (_, index) => ({
        roleId: `role-${index + 1}`,
        assetUrl: `https://assets.example.com/representative-${index + 1}.jpg`,
      })),
      panels: [
        { slot: 1, assetUrl: "https://assets.example.com/panel-1.jpg" },
      ],
      detailImageUrl: "https://assets.example.com/detail-page.jpg",
      representativeIndividualsPassed: true,
      detailSetIdentityPassed: true,
      finalizerMode: "server-v1",
      finalizerPhase: "complete",
    },
  });

  assert.equal(isRecoverableServerFinalAssemblyJob(completed), false);
  assert.equal(canReassembleCompletedDetailPageJob(completed), true);
  assert.equal(
    canReassembleCompletedDetailPageJob({
      ...completed,
      result: { ...completed.result, representatives: completed.result.representatives.slice(0, 4) },
    }),
    false,
  );
  assert.match(startRouteSource, /command\.action === "reassemble_final_only"/);
  assert.match(
    startRouteSource,
    /completedFinalReassembly[\s\S]*status: "render_pending"[\s\S]*progress: completedFinalReassembly[\s\S]*\? 95/,
  );
});

test("Standard-v2 failure keeps exact section scores, defects, screenshot diagnostics, and retry scope", () => {
  const failed = job({
    stage: "standard_quality_gate",
    progress: 94,
    attempt: 14,
    error: "STANDARD_QUALITY_BLOCKED",
    result: {
      ...job().result,
      runId: "run-mini-gymball-14",
      standardFailure: {
        code: "STANDARD_QUALITY_BLOCKED",
        summary_ko: "상세 섹션 1, 상세 섹션 3이 Standard-v2 품질 하한선을 통과하지 못했습니다.",
        retryable_panel_slots: [1, 3],
        panel_retry_instructions: {
          1: "Preserve the round product shape.",
          3: "Remove the unrelated electronic product.",
        },
        panel_diagnostics: [
          {
            role_id: "panel-1",
            slot: 1,
            label_ko: "상세 섹션 1",
            status: "review_required",
            policy_label_ko: "히어로",
            scores: { shape: 79, identity: 81, size: -1, scene_context: -1 },
            score_floors: { shape: 84, identity: 86, size: null, scene_context: null },
            blocker_codes: ["quality_review_required", "quality_score_below_floor"],
            blocker_labels_ko: ["검토 필요 패널 존재", "Standard 점수 하한 미달"],
            issue_labels_ko: ["제품 형태 불일치"],
            retry_instruction: "Preserve the round product shape.",
            retryable: true,
            is_problem: true,
          },
          {
            role_id: "panel-3",
            slot: 3,
            label_ko: "상세 섹션 3",
            status: "review_required",
            scores: { shape: 90, identity: 60, size: 80, scene_context: 90 },
            score_floors: { shape: 82, identity: 84, size: 72, scene_context: 86 },
            blocker_codes: ["quality_issue_present"],
            blocker_labels_ko: ["품질 결함 감지"],
            issue_labels_ko: ["다른 제품"],
            retry_instruction: "Remove the unrelated electronic product.",
            retryable: true,
            is_problem: true,
          },
        ],
      },
    },
  });

  const diagnostics = detailPageStandardDiagnostics(failed);
  assert.equal(canResumeDetailPageCheckpoint(failed), true);
  assert.equal(detailPageFailureCode(failed), "STANDARD_QUALITY_BLOCKED");
  assert.equal(detailPageCheckpointId(failed), "run-mini-gymball-14");
  assert.deepEqual(diagnostics.map((item) => item.slot), [1, 3]);
  assert.deepEqual(diagnostics[0].scores, {
    shape: 79,
    identity: 81,
    size: -1,
    sceneContext: -1,
  });
  assert.deepEqual(standardQualityRetryPlan(failed.result), {
    slots: [1, 3],
    instructions: {
      1: "Preserve the round product shape.",
      3: "Remove the unrelated electronic product.",
    },
  });
  const assets = detailPageReviewAssets(failed);
  assert.equal(assets.panels[0].problem, true);
  assert.equal(assets.panels[1].problem, true);
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
  assert.equal(hasFullAssetDetailPageAssessment(failed), false);
  assert.equal(
    hasFullAssetDetailPageAssessment({
      ...failed,
      result: {
        ...failed.result,
        setAssessment: {
          ...failed.result.setAssessment,
          assessment_version: "full_generated_asset_identity_v1",
        },
      },
    }),
    true,
  );
});

test("server final-assembly failures stay recoverable and ignore stale Standard diagnostics", () => {
  const staleStandardFailure = {
    code: "STANDARD_QUALITY_BLOCKED",
    summary_ko: "과거 상세 섹션 1 품질실패",
    panel_diagnostics: [
      {
        role_id: "panel-1",
        slot: 1,
        status: "review_required",
        retryable: true,
      },
    ],
  };
  const finalizerFailure = job({
    status: "failed",
    stage: "server_generation",
    progress: 98,
    qaStatus: "failed",
    error: 'TypeError: The "path" argument must be of type string. Received type number (27732)',
    result: {
      ...job().result,
      setAssessment: {
        ...job().result.setAssessment,
        status: "passed",
      },
      standardFailure: staleStandardFailure,
      representativeIndividualsPassed: true,
      detailSetIdentityPassed: true,
      finalizerMode: "server-v1",
      finalizerPhase: "rendering",
      finalizerStartedAt: "2026-08-03T04:40:00.000Z",
    },
  });

  assert.equal(isRecoverableServerFinalAssemblyJob(finalizerFailure), true);
  assert.equal(detailPageReviewBucket(finalizerFailure), "active");
  assert.equal(isActiveDetailPageJob(finalizerFailure), true);
  assert.equal(
    detailPageStageLabel(finalizerFailure),
    "서버 최종 14,000px 조립",
  );
  assert.deepEqual(detailPageStandardDiagnostics(finalizerFailure), []);
  assert.equal(detailPageProblemReason(finalizerFailure), finalizerFailure.error);
  assert.equal(detailPageFailureCode(finalizerFailure), "SERVER_FINALIZER_FAILED");
  assert.equal(
    detailPageFailureCode({
      ...finalizerFailure,
      error: "SERVER_FINALIZER_FONT_LOAD_FAILED: 서버 한글 폰트를 불러오지 못했습니다.",
    }),
    "SERVER_FINALIZER_FONT_LOAD_FAILED",
  );
});

test("a new source-upload failure falls back to the latest resumable checkpoint for the same product", () => {
  const checkpoint = job({
    jobId: "11112233-4455-4677-8899-aabbccddeeff",
    attempt: 6,
    updatedAt: "2026-08-02T06:25:00.000Z",
  });
  const olderCheckpoint = job({
    jobId: "22222233-4455-4677-8899-aabbccddeeff",
    attempt: 5,
    updatedAt: "2026-08-02T06:24:00.000Z",
  });
  const sourceFailure = job({
    jobId: "33332233-4455-4677-8899-aabbccddeeff",
    stage: "source_collection",
    progress: 5,
    attempt: 7,
    error: "The resource already exists",
    payload: { product_name: "미니짐볼 300g 색상랜덤" },
    result: {},
    updatedAt: "2026-08-02T06:47:00.000Z",
  });
  const otherProduct = job({
    jobId: "44442233-4455-4677-8899-aabbccddeeff",
    itemId: "launch-other",
    attempt: 10,
    updatedAt: "2026-08-02T06:46:00.000Z",
  });

  assert.equal(canResumeDetailPageCheckpoint(sourceFailure), false);
  assert.equal(
    findDetailPageResumeCandidate(
      [sourceFailure, olderCheckpoint, otherProduct, checkpoint],
      sourceFailure,
    )?.jobId,
    checkpoint.jobId,
  );
  assert.equal(
    findDetailPageResumeCandidate([sourceFailure, otherProduct], sourceFailure),
    null,
  );
});

test("an overwritten evidence-upload stage resumes the checkpoint preserved in the same durable job", () => {
  const preserved = job({
    stage: "evidence_upload",
    progress: 5,
    error: "The resource already exists",
  });

  assert.equal(canResumeDetailPageCheckpoint(preserved), true);
  assert.equal(
    findDetailPageResumeCandidate([preserved], preserved)?.jobId,
    preserved.jobId,
  );
});

test("review requests target an exact checkpoint or explicitly force a full regeneration", () => {
  assert.match(dockSource, /requestedJobId/);
  assert.match(dockSource, /options\.mode === "full" \? null/);
  assert.match(dockSource, /candidate\.jobId === options\.requestedJobId/);
  assert.match(dockSource, /전체 재생성을 별도로 선택하세요/);
  assert.match(dockSource, /commerce-os-detail-page-ai-review/);
  assert.match(dockSource, /문제 자산만 이어서 생성합니다/);
  assert.match(workspaceSource, /if \(partial\) \{/);
  assert.match(workspaceSource, /method: "POST"/);
  assert.match(workspaceSource, /credentials: "same-origin"/);
  assert.match(jobRouteSource, /canResumeDetailPageCheckpoint\(job\)/);
  assert.match(jobRouteSource, /panelRetrySlots: standardGateFailure \? standardRetry\.slots : \[\]/);
  assert.match(jobRouteSource, /standardRetryUsed: standardGateFailure/);
  assert.match(jobRouteSource, /const finalAssemblyFailure/);
  assert.match(
    jobRouteSource,
    /finalAssemblyFailure[\s\S]*status: "render_pending"[\s\S]*stage: "server_final_assembly"/,
  );
  assert.match(
    jobRouteSource,
    /Math\.max\([\s\S]*Number\(job\.progress\)[\s\S]*reportedProgress/,
  );
  assert.match(
    jobRouteSource,
    /finalAssemblyFailure[\s\S]*standardFailure: null[\s\S]*completed_at: null/,
  );
  assert.match(startRouteSource, /isRecoverableServerFinalAssemblyJob/);
  assert.match(
    startRouteSource,
    /job\.status === "failed" && recoverableFinalAssembly[\s\S]*status: "render_pending"/,
  );
});
