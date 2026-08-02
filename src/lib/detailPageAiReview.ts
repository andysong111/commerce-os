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

const ROLE_LABELS: Record<string, string> = {
  main: "대표 이미지",
  main_hero: "대표 이미지",
  hero: "대표 이미지",
  alternate_whole: "부가 이미지 · 전체 형태",
  use_scene: "부가 이미지 · 사용 장면",
  feature_closeup: "부가 이미지 · 특징 확대",
  scale_or_package: "부가 이미지 · 크기·구성",
  package_or_scale: "부가 이미지 · 구성·크기",
  package: "부가 이미지 · 패키지",
};

export function detailPageJobName(job: DetailPageReviewJob) {
  const payload = record(job.payload);
  return text(
    payload.product_name ||
      payload.product_name_hint ||
      job.itemId ||
      "상품명 미지정",
  );
}

export function detailPageReviewBucket(
  job: DetailPageReviewJob,
): DetailPageReviewBucket {
  if (job.status === "failed" || job.qaStatus === "failed") return "needs_review";
  if (ACTIVE.has(job.status)) return "active";
  if (job.status === "success" && job.qaStatus === "passed") return "passed";
  return "cancelled";
}

export function isActiveDetailPageJob(job: DetailPageReviewJob) {
  return ACTIVE.has(job.status);
}

export function canResumeDetailPageCheckpoint(job: DetailPageReviewJob) {
  const evidence = record(job.payload).evidence_urls;
  const analysis = record(record(job.result).analysis);
  return Boolean(
    job.status === "failed" &&
      job.stage === "server_generation" &&
      Array.isArray(evidence) &&
      evidence.length > 0 &&
      analysis.product,
  );
}

export function detailPageStageLabel(job: DetailPageReviewJob) {
  const labels: Record<string, string> = {
    source_collection: "1688 원본 수집",
    queued: "서버 생성 대기",
    checkpoint_resume: "문제 자산 복구 대기",
    server_generation: "AI 생성·검수",
    render_pending: "최종 14,000px 조립",
    docked: "상품출시진행관리 도킹",
    cancelled: "사용자 취소",
  };
  return labels[job.stage] || humanize(job.stage) || "상태 확인 중";
}

export function detailPageProblemReason(job: DetailPageReviewJob) {
  const result = record(job.result);
  const assessment = record(result.setAssessment);
  const candidates = [
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
