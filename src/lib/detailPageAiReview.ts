export type DetailPageJobStatus =
  | "collecting"
  | "queued"
  | "running"
  | "render_pending"
  | "success"
  | "failed"
  | "cancelled";

export type DetailPageReviewJob = {
  jobId: string;
  itemId: string;
  status: DetailPageJobStatus;
  stage: string;
  message: string;
  progress: number;
  qaStatus: string;
  attempt: number;
  sourceUrl?: string;
  sourceRunId?: string;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt: string | null;
};

export type DetailPageReviewAsset = {
  id: string;
  url: string;
  label: string;
  roleId: string;
  kind: "representative" | "panel" | "evidence" | "detail";
  problem: boolean;
};

export type DetailPageStandardPanelDiagnostic = {
  roleId: string;
  slot: number;
  label: string;
  status: string;
  policyLabel: string;
  scores: {
    shape: number | null;
    identity: number | null;
    size: number | null;
    sceneContext: number | null;
  };
  scoreFloors: {
    shape: number | null;
    identity: number | null;
    size: number | null;
    sceneContext: number | null;
  };
  blockerCodes: string[];
  blockerLabels: string[];
  issueLabels: string[];
  reason: string;
  retryInstruction: string;
  retryable: boolean;
};

export type DetailPageReviewBucket =
  | "needs_review"
  | "active"
  | "passed"
  | "cancelled";

const ACTIVE = new Set<DetailPageJobStatus>([
  "collecting",
  "queued",
  "running",
  "render_pending",
]);

// A checkpointed job can be accidentally pushed back into a source stage by an
// older cached retry worker. The durable payload/result are merge-preserved, so
// use their contents as the authority instead of discarding a valid checkpoint
// solely because the mutable stage was overwritten.
const RESUMABLE_CHECKPOINT_STAGES = new Set([
  "server_generation",
  "standard_quality_gate",
  "source_collection",
  "evidence_upload",
]);

const ROLE_LABELS: Record<string, string> = {
  main: "대표 이미지",
  main_hero: "대표 이미지",
  hero: "대표 이미지",
  main_catalog: "대표 이미지",
  alternate_whole: "부가 이미지 1 · 전체 형태",
  evidence_detail: "부가 이미지 2 · 특징 확대",
  lifestyle_usage: "부가 이미지 3 · 사용 장면",
  adaptive_support: "부가 이미지 4 · 보조 정보",
  use_scene: "부가 이미지 3 · 사용 장면",
  feature_closeup: "부가 이미지 2 · 특징 확대",
  scale_or_package: "부가 이미지 4 · 크기·구성",
  package_or_scale: "부가 이미지 4 · 구성·크기",
  package: "부가 이미지 4 · 패키지",
};

const MANUAL_REGENERATION_REPRESENTATIVE_ROLES = [
  "main_catalog",
  "alternate_whole",
  "evidence_detail",
  "lifestyle_usage",
  "adaptive_support",
] as const;

const REPRESENTATIVE_ROLE_ALIASES: Record<string, string> = {
  main: "main_catalog",
  main_hero: "main_catalog",
  hero: "main_catalog",
  "additional-1": "alternate_whole",
  "additional-2": "evidence_detail",
  "additional-3": "lifestyle_usage",
  "additional-4": "adaptive_support",
};

export type SelectedDetailPageAssetRegenerationPlan = {
  selectedRoleIds: string[];
  representativeRoleIds: string[];
  panelSlots: number[];
  remainingRepresentatives: unknown[];
  remainingPanels: unknown[];
};

export function detailPageJobName(job: DetailPageReviewJob) {
  const payload = record(job.payload);
  return text(
    payload.product_name_hint ||
      payload.product_name ||
      job.itemId ||
      "상품명 미지정",
  );
}

export function mergeDetailPageReviewJobs(
  ...groups: DetailPageReviewJob[][]
) {
  const jobs = new Map<string, DetailPageReviewJob>();
  for (const group of groups) {
    for (const job of group) {
      const current = jobs.get(job.jobId);
      if (
        !current ||
        Date.parse(job.updatedAt || "") > Date.parse(current.updatedAt || "")
      ) {
        jobs.set(job.jobId, job);
      }
    }
  }
  return [...jobs.values()].sort(
    (left, right) =>
      Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""),
  );
}

export function detailPageReviewBucket(
  job: DetailPageReviewJob,
): DetailPageReviewBucket {
  if (isRecoverableServerFinalAssemblyJob(job)) return "active";
  if (job.status === "failed" || job.qaStatus === "failed") return "needs_review";
  if (ACTIVE.has(job.status)) return "active";
  if (job.status === "success" && job.qaStatus === "passed") return "passed";
  return "cancelled";
}

export function isActiveDetailPageJob(job: DetailPageReviewJob) {
  return ACTIVE.has(job.status) || isRecoverableServerFinalAssemblyJob(job);
}

export function isRecoverableServerFinalAssemblyJob(
  job: Pick<DetailPageReviewJob, "status" | "stage" | "result">,
) {
  const result = record(job.result);
  const finalizerMode = text(result.finalizerMode || result.finalizer_mode);
  const finalizerPhase = text(result.finalizerPhase || result.finalizer_phase);
  const qualityPassed = generatedAssetQualityPassed(result);

  if (job.status === "render_pending") return true;
  if (job.stage === "server_final_assembly" && qualityPassed) return true;
  return Boolean(
    job.status === "failed" &&
      finalizerMode === "server-v1" &&
      finalizerPhase &&
      finalizerPhase !== "complete" &&
      qualityPassed,
  );
}

export function canReassembleCompletedDetailPageJob(
  job: Pick<DetailPageReviewJob, "status" | "result">,
) {
  const result = record(job.result);
  const finalizerMode = text(result.finalizerMode || result.finalizer_mode);
  const finalizerPhase = text(result.finalizerPhase || result.finalizer_phase);
  const representativeCount = array(result.representatives).filter((value) => {
    const item = record(value);
    return Boolean(
      firstUrl(
        item.assetUrl,
        item.asset_url,
        item.imageUrl,
        item.image_url,
        item.url,
      ),
    );
  }).length;
  const panelCount = array(
    result.panels || result.detailPanels || result.detail_panels,
  ).filter((value) => {
    const item = record(value);
    return Boolean(
      firstUrl(
        item.assetUrl,
        item.asset_url,
        item.imageUrl,
        item.image_url,
        item.panelUrl,
        item.panel_url,
        item.url,
      ),
    );
  }).length;

  return Boolean(
    job.status === "success" &&
      finalizerMode === "server-v1" &&
      finalizerPhase === "complete" &&
      generatedAssetQualityPassed(result) &&
      representativeCount === 5 &&
      panelCount > 0 &&
      firstUrl(result.detailImageUrl, result.detail_image_url)
  );
}

export function canRevalidateCompletedDetailPageJob(
  job: Pick<DetailPageReviewJob, "status" | "payload" | "result">,
) {
  const evidence = array(record(job.payload).evidence_urls)
    .map(safeUrl)
    .filter(Boolean);
  return Boolean(
    canReassembleCompletedDetailPageJob(job) && evidence.length > 0,
  );
}

export function canRegenerateSelectedDetailPageAssets(
  job: Pick<DetailPageReviewJob, "status" | "stage" | "payload" | "result">,
) {
  if (
    !["success", "failed"].includes(job.status) ||
    ACTIVE.has(job.status) ||
    isRecoverableServerFinalAssemblyJob(job)
  ) {
    return false;
  }
  const payload = record(job.payload);
  const result = record(job.result);
  const analysis = record(result.analysis);
  const representatives = array(result.representatives);
  const representativeRoles = new Set(
    representatives.map((value) => canonicalRepresentativeRole(value)),
  );
  const panels = array(result.panels || result.detailPanels || result.detail_panels)
    .filter((value) => {
      const item = record(value);
      const slot = Number(item.slot ?? item.sectionSlot ?? item.section_slot);
      return Number.isInteger(slot) && slot > 0 && Boolean(panelAssetUrl(item));
    });
  return Boolean(
    array(payload.evidence_urls).map(safeUrl).filter(Boolean).length > 0 &&
      analysis.product &&
      representatives.length === MANUAL_REGENERATION_REPRESENTATIVE_ROLES.length &&
      MANUAL_REGENERATION_REPRESENTATIVE_ROLES.every((roleId) =>
        representativeRoles.has(roleId),
      ) &&
      representatives.every((value) =>
        Boolean(representativeAssetUrl(record(value))),
      ) &&
      panels.length > 0
  );
}

export function selectedDetailPageAssetRegenerationPlan(
  job: Pick<DetailPageReviewJob, "status" | "stage" | "payload" | "result">,
  requestedRoleIds: unknown,
): SelectedDetailPageAssetRegenerationPlan | null {
  if (!canRegenerateSelectedDetailPageAssets(job)) return null;
  const requested = [
    ...new Set(
      array(requestedRoleIds)
        .map(text)
        .map((value) => value.toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (!requested.length) return null;

  const result = record(job.result);
  const representatives = array(result.representatives);
  const panels = array(result.panels || result.detailPanels || result.detail_panels);
  const existingRepresentativeRoles = new Set(
    representatives.map((value) => canonicalRepresentativeRole(value)),
  );
  const existingPanelSlots = new Set(
    panels
      .map((value) => {
        const item = record(value);
        return Number(item.slot ?? item.sectionSlot ?? item.section_slot);
      })
      .filter((slot) => Number.isInteger(slot) && slot > 0),
  );
  const representativeRoleIds: string[] = [];
  const panelSlots: number[] = [];

  for (const requestedRoleId of requested) {
    const panelMatch = requestedRoleId.match(/^panel-(\d+)$/);
    if (panelMatch) {
      const slot = Number(panelMatch[1]);
      if (!existingPanelSlots.has(slot)) return null;
      panelSlots.push(slot);
      continue;
    }
    const representativeRoleId = canonicalRepresentativeRole(requestedRoleId);
    if (!existingRepresentativeRoles.has(representativeRoleId)) return null;
    representativeRoleIds.push(representativeRoleId);
  }

  const representativeSet = new Set(representativeRoleIds);
  const panelSet = new Set(panelSlots);
  const selectedRoleIds = [
    ...representativeRoleIds,
    ...panelSlots.map((slot) => `panel-${slot}`),
  ];
  return {
    selectedRoleIds,
    representativeRoleIds,
    panelSlots,
    remainingRepresentatives: representatives.filter(
      (value) => !representativeSet.has(canonicalRepresentativeRole(value)),
    ),
    remainingPanels: panels.filter((value) => {
      const item = record(value);
      const slot = Number(item.slot ?? item.sectionSlot ?? item.section_slot);
      return !panelSet.has(slot);
    }),
  };
}

function generatedAssetQualityPassed(result: Record<string, unknown>) {
  const assessment = record(result.setAssessment);
  return Boolean(
    assessment.status === "passed" ||
      (result.representativeIndividualsPassed === true &&
        result.detailSetIdentityPassed === true),
  );
}

export function canResumeDetailPageCheckpoint(
  job: Pick<DetailPageReviewJob, "status" | "stage" | "payload" | "result">,
) {
  const evidence = record(job.payload).evidence_urls;
  const analysis = record(record(job.result).analysis);
  return Boolean(
    job.status === "failed" &&
      RESUMABLE_CHECKPOINT_STAGES.has(job.stage) &&
      Array.isArray(evidence) &&
      evidence.length > 0 &&
      analysis.product,
  );
}

export function hasFullAssetDetailPageAssessment(job: DetailPageReviewJob) {
  const assessment = record(record(job.result).setAssessment);
  return /^full_generated_asset_identity_v\d+$/.test(
    text(assessment.assessment_version),
  );
}

export function findDetailPageResumeCandidate(
  jobs: DetailPageReviewJob[],
  selected: DetailPageReviewJob,
) {
  if (canResumeDetailPageCheckpoint(selected)) return selected;
  return (
    jobs
      .filter(
        (candidate) =>
          candidate.itemId === selected.itemId &&
          candidate.jobId !== selected.jobId &&
          canResumeDetailPageCheckpoint(candidate),
      )
      .sort((left, right) => resumeCandidateTime(right) - resumeCandidateTime(left))[0] ??
    null
  );
}

export function detailPageStageLabel(job: DetailPageReviewJob) {
  if (isRecoverableServerFinalAssemblyJob(job)) {
    return "서버 최종 14,000px 조립";
  }
  const labels: Record<string, string> = {
    source_collection: "1688 원본 수집",
    queued: "서버 생성 대기",
    checkpoint_resume: "문제 자산 복구 대기",
    checkpoint_revalidation: "저장 자산 재검수",
    checkpoint_manual_selection: "선택 이미지 부분 재생성",
    asset_candidate_generation: "선택 이미지 후보 생성",
    asset_candidate_qa: "선택 이미지 독립 검수",
    asset_candidate_correction: "선택 이미지 1회 보정",
    server_generation: "AI 생성·검수",
    server_final_assembly: "서버 최종 14,000px 조립",
    standard_quality_retry: "Standard-v2 차단 섹션 부분 재생성",
    standard_quality_gate: "Standard-v2 품질 하한선",
    render_pending: "최종 14,000px 조립",
    docked: "상품출시진행관리 도킹",
    cancelled: "사용자 취소",
  };
  return labels[job.stage] || humanize(job.stage) || "상태 확인 중";
}

export function detailPageProblemReason(job: DetailPageReviewJob) {
  const result = record(job.result);
  const assessment = record(result.setAssessment);
  const standardFailure = activeStandardFailure(job);
  const candidates = [
    standardFailure.summary_ko,
    standardFailure.summaryKo,
    job.error,
    assessment.summary,
    assessment.reason,
    assessment.message,
    assessment.instruction,
    result.representativeRetryInstruction,
    job.message,
  ];
  return candidates.map(text).find(Boolean) || "AI 검수에서 확인이 필요한 항목이 발견됐습니다.";
}

export function detailPageStandardDiagnostics(
  job: DetailPageReviewJob,
): DetailPageStandardPanelDiagnostic[] {
  if (
    job.stage !== "standard_quality_gate" ||
    isRecoverableServerFinalAssemblyJob(job)
  ) {
    return [];
  }
  return standardPanelDiagnostics(record(job.result));
}

export function standardQualityRetryPlan(resultValue: unknown) {
  const result = record(resultValue);
  const failure = record(result.standardFailure || result.standard_failure);
  const diagnostics = standardPanelDiagnostics(result);
  const explicitSlots = array(
    failure.retryable_panel_slots || failure.retryablePanelSlots,
  )
    .map(Number)
    .filter((slot) => Number.isInteger(slot) && slot > 0);
  const slots = [
    ...new Set(
      explicitSlots.length
        ? explicitSlots
        : diagnostics.filter((item) => item.retryable).map((item) => item.slot),
    ),
  ].sort((left, right) => left - right);
  const storedInstructions = record(
    failure.panel_retry_instructions || failure.panelRetryInstructions,
  );
  const instructions = Object.fromEntries(
    slots.map((slot) => {
      const diagnostic = diagnostics.find((item) => item.slot === slot);
      return [
        String(slot),
        text(storedInstructions[String(slot)]) ||
          diagnostic?.retryInstruction ||
          "Regenerate only this Standard-blocked detail panel from the authoritative seller-source identity image.",
      ];
    }),
  );
  return { slots, instructions };
}

export function detailPageFailureCode(job: DetailPageReviewJob) {
  const result = record(job.result);
  const failure = activeStandardFailure(job);
  if (job.stage === "standard_quality_gate") {
    return text(failure.code) || "STANDARD_QUALITY_BLOCKED";
  }
  if (isRecoverableServerFinalAssemblyJob(job)) {
    const payload = record(job.payload);
    return (
      text(
        payload.finalizer_error_code ||
          result.finalizerErrorCode ||
          result.finalizer_error_code,
      ) ||
      stableErrorCode(job.error) ||
      "SERVER_FINALIZER_FAILED"
    );
  }
  return stableErrorCode(job.error) || "DETAIL_PAGE_GENERATION_FAILED";
}

export function detailPageCheckpointId(job: DetailPageReviewJob) {
  const result = record(job.result);
  const failure = activeStandardFailure(job);
  return text(
    failure.source_run_id ||
      failure.sourceRunId ||
      result.runId ||
      result.run_id ||
      job.sourceRunId,
  );
}

function activeStandardFailure(job: DetailPageReviewJob) {
  if (
    job.stage !== "standard_quality_gate" ||
    isRecoverableServerFinalAssemblyJob(job)
  ) {
    return {};
  }
  const result = record(job.result);
  return record(result.standardFailure || result.standard_failure);
}

function stableErrorCode(value: unknown) {
  const match = text(value).match(/\b([A-Z][A-Z0-9_]{2,})\s*:/);
  return match?.[1] || "";
}

export function detailPageReviewAssets(job: DetailPageReviewJob): {
  representatives: DetailPageReviewAsset[];
  panels: DetailPageReviewAsset[];
  evidence: DetailPageReviewAsset[];
  detail: DetailPageReviewAsset[];
  problemRoleIds: Set<string>;
} {
  const result = record(job.result);
  const problemRoleIds = findProblemRoleIds(job);
  const representatives = array(result.representatives)
    .map((value, index): DetailPageReviewAsset | null => {
      const item = record(value);
      const roleId = text(item.roleId || item.role_id || item.role || `representative-${index + 1}`);
      const url = firstUrl(item.assetUrl, item.asset_url, item.imageUrl, item.image_url, item.url);
      if (!url) return null;
      return {
        id: `representative:${roleId}:${index}`,
        url,
        label: roleLabel(roleId, index),
        roleId,
        kind: "representative" as const,
        problem: problemRoleIds.has(roleId.toLowerCase()),
      };
    })
    .filter(notNull);

  if (!representatives.length) {
    const main = firstUrl(result.mainImageUrl, result.main_image_url);
    if (main) {
      representatives.push({
        id: "representative:main",
        url: main,
        label: "대표 이미지",
        roleId: "main",
        kind: "representative",
        problem: problemRoleIds.has("main"),
      });
    }
    array(result.additionalImageUrls || result.additional_image_urls).forEach(
      (value, index) => {
        const url = safeUrl(value);
        if (!url) return;
        representatives.push({
          id: `representative:additional-${index + 1}`,
          url,
          label: `부가 이미지 ${index + 1}`,
          roleId: `additional-${index + 1}`,
          kind: "representative",
          problem: false,
        });
      },
    );
  }

  const panels = array(result.panels || result.detailPanels || result.detail_panels)
    .map((value, index): DetailPageReviewAsset | null => {
      const item = record(value);
      const slot = Number(item.slot ?? item.sectionSlot ?? item.section_slot);
      const roleId = Number.isInteger(slot) && slot > 0
        ? `panel-${slot}`
        : text(
            item.sectionId ||
              item.section_id ||
              item.panelId ||
              item.panel_id ||
              `panel-${index + 1}`,
          );
      const url = firstUrl(
        item.assetUrl,
        item.asset_url,
        item.imageUrl,
        item.image_url,
        item.panelUrl,
        item.panel_url,
        item.url,
      );
      if (!url) return null;
      return {
        id: `panel:${roleId}:${index}`,
        url,
        label:
          text(item.title || item.label) ||
          `상세 섹션 ${Number.isInteger(slot) && slot > 0 ? slot : index + 1}`,
        roleId,
        kind: "panel" as const,
        problem: problemRoleIds.has(roleId.toLowerCase()),
      };
    })
    .filter(notNull);

  const payload = record(job.payload);
  const evidenceNames = array(payload.evidence_names).map(text);
  const evidence = array(payload.evidence_urls)
    .map((value, index): DetailPageReviewAsset | null => {
      const url = safeUrl(value);
      if (!url) return null;
      return {
        id: `evidence:${index}`,
        url,
        label: evidenceNames[index] || `1688 원본 ${index + 1}`,
        roleId: `evidence-${index + 1}`,
        kind: "evidence" as const,
        problem: false,
      };
    })
    .filter(notNull);

  const detailUrl = firstUrl(result.detailImageUrl, result.detail_image_url);
  const detail: DetailPageReviewAsset[] = detailUrl
    ? [{
        id: "detail:final",
        url: detailUrl,
        label: "최종 14,000px 상세페이지",
        roleId: "detail-page",
        kind: "detail" as const,
        problem: false,
      }]
    : [];

  return { representatives, panels, evidence, detail, problemRoleIds };
}

export function detailPageRoleLabel(roleId: string) {
  return ROLE_LABELS[roleId.toLowerCase()] || humanize(roleId) || "생성 이미지";
}

function findProblemRoleIds(job: DetailPageReviewJob) {
  const result = record(job.result);
  const assessment = record(result.setAssessment);
  const representatives = array(result.representatives)
    .map((value) => text(record(value).roleId || record(value).role_id || record(value).role))
    .filter(Boolean);
  const haystack = [
    job.error,
    job.message,
    result.representativeRetryInstruction,
    assessment.summary,
    assessment.reason,
    assessment.message,
    assessment.instruction,
  ]
    .map(text)
    .join(" ")
    .toLowerCase();
  const found = new Set<string>();
  for (const diagnostic of detailPageStandardDiagnostics(job)) {
    found.add(diagnostic.roleId.toLowerCase());
  }
  for (const roleId of representatives) {
    if (haystack.includes(roleId.toLowerCase())) found.add(roleId.toLowerCase());
  }
  const explicit = text(result.representativeRetryRole).toLowerCase();
  if (explicit) found.add(explicit);
  for (const slot of array(assessment.mismatched_panel_slots)) {
    const normalized = Number(slot);
    if (Number.isInteger(normalized) && normalized > 0) {
      found.add(`panel-${normalized}`);
    }
  }
  collectStructuredProblemRoles(assessment, found, 0);
  return found;
}

function standardPanelDiagnostics(
  result: Record<string, unknown>,
): DetailPageStandardPanelDiagnostic[] {
  const failure = record(result.standardFailure || result.standard_failure);
  return array(failure.panel_diagnostics || failure.panelDiagnostics)
    .map((value): DetailPageStandardPanelDiagnostic | null => {
      const item = record(value);
      const slot = Number(item.slot || item.panel_slot || item.panelSlot);
      if (!Number.isInteger(slot) || slot < 1) return null;
      const scores = record(item.scores);
      const floors = record(item.score_floors || item.scoreFloors);
      return {
        roleId: text(item.role_id || item.roleId) || `panel-${slot}`,
        slot,
        label: text(item.label_ko || item.label) || `상세 섹션 ${slot}`,
        status: text(item.status) || "unknown",
        policyLabel: text(item.policy_label_ko || item.policyLabel),
        scores: {
          shape: numeric(scores.shape),
          identity: numeric(scores.identity),
          size: numeric(scores.size),
          sceneContext: numeric(scores.scene_context ?? scores.sceneContext),
        },
        scoreFloors: {
          shape: numeric(floors.shape),
          identity: numeric(floors.identity),
          size: numeric(floors.size),
          sceneContext: numeric(
            floors.scene_context ?? floors.sceneContext,
          ),
        },
        blockerCodes: array(item.blocker_codes || item.blockerCodes).map(text).filter(Boolean),
        blockerLabels: array(item.blocker_labels_ko || item.blockerLabels).map(text).filter(Boolean),
        issueLabels: array(item.issue_labels_ko || item.issueLabels || item.issues).map(text).filter(Boolean),
        reason: text(item.reason),
        retryInstruction: text(item.retry_instruction || item.retryInstruction),
        retryable: item.retryable !== false,
      };
    })
    .filter(notNull)
    .sort((left, right) => left.slot - right.slot);
}

function collectStructuredProblemRoles(
  value: unknown,
  found: Set<string>,
  depth: number,
) {
  if (depth > 4) return;
  if (Array.isArray(value)) {
    for (const item of value) collectStructuredProblemRoles(item, found, depth + 1);
    return;
  }
  const item = record(value);
  if (!Object.keys(item).length) return;
  for (const key of [
    "correctionRole",
    "correction_role",
    "retryRole",
    "retry_role",
    "selectedRole",
    "selected_role",
    "mismatchRole",
    "mismatch_role",
    "recommendedRetryRoleId",
    "recommended_retry_role_id",
  ]) {
    const explicit = text(item[key]).toLowerCase();
    if (explicit) found.add(explicit);
  }
  const role = text(item.roleId || item.role_id || item.role).toLowerCase();
  const panelSlot = Number(item.panelSlot ?? item.panel_slot);
  const status = text(item.status || item.verdict || item.result).toLowerCase();
  const failed =
    item.identityMatch === false ||
    item.identity_match === false ||
    item.matchesOriginal === false ||
    item.matches_original === false ||
    item.passed === false ||
    item.isProblem === true ||
    item.is_problem === true ||
    ["fail", "failed", "mismatch", "different_product", "reject", "rejected"].includes(status);
  if (role && failed) found.add(role);
  if (Number.isInteger(panelSlot) && panelSlot > 0 && failed) {
    found.add(`panel-${panelSlot}`);
  }
  for (const nested of Object.values(item)) {
    if (nested && typeof nested === "object") {
      collectStructuredProblemRoles(nested, found, depth + 1);
    }
  }
}

function resumeCandidateTime(job: DetailPageReviewJob) {
  const updatedAt = Date.parse(job.updatedAt);
  if (Number.isFinite(updatedAt)) return updatedAt;
  return Number.isFinite(job.attempt) ? job.attempt : 0;
}

function canonicalRepresentativeRole(value: unknown) {
  const item = record(value);
  const raw = text(
    typeof value === "string"
      ? value
      : item.roleId || item.role_id || item.role,
  ).toLowerCase();
  return REPRESENTATIVE_ROLE_ALIASES[raw] || raw;
}

function representativeAssetUrl(item: Record<string, unknown>) {
  return firstUrl(
    item.assetUrl,
    item.asset_url,
    item.imageUrl,
    item.image_url,
    item.url,
  );
}

function panelAssetUrl(item: Record<string, unknown>) {
  return firstUrl(
    item.assetUrl,
    item.asset_url,
    item.imageUrl,
    item.image_url,
    item.panelUrl,
    item.panel_url,
    item.url,
  );
}

function roleLabel(roleId: string, index: number) {
  return ROLE_LABELS[roleId.toLowerCase()] ||
    (index === 0 ? "대표 이미지" : `부가 이미지 ${index}`);
}

function humanize(value: unknown) {
  return text(value).replace(/[_-]+/g, " ");
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function numeric(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function safeUrl(value: unknown) {
  const candidate = text(value);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function firstUrl(...values: unknown[]) {
  return values.map(safeUrl).find(Boolean) || "";
}

function notNull<T>(value: T | null): value is T {
  return value !== null;
}
