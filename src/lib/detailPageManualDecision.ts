export type V260807ManualDecisionKind =
  | "resume_checkpoint"
  | "identity_conflict"
  | "generation_safety_block"
  | null;

export type V260807ResumeReason =
  | "auto_recovery_exhausted"
  | "identity_review_outcome_unknown"
  | null;

export type ManualDecisionJobLike = {
  status: string;
  stage: string;
  error?: string;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
};

export type V260807SourceAnchorSnapshot = {
  anchorIndex: number;
  anchorUrl: string;
  evidenceUrls: string[];
  evidenceNames: string[];
};

export type V260807IdentitySnapshot = V260807SourceAnchorSnapshot & {
  failedRoleId: string;
  reason: string;
  failedAssetUrl: string;
};

const REPRESENTATIVE_ROLES = new Set([
  "main_catalog",
  "alternate_whole",
  "evidence_detail",
  "lifestyle_usage",
  "adaptive_support",
]);
const SAFE_UNKNOWN_OUTCOME_STAGES = new Set([
  "v3_representative_identity_review",
]);
const GENERATION_SAFETY_BLOCK_PATTERN =
  /moderation_blocked|safety\s*(?:check|filter|review).*block|안전\s*검사에서\s*차단|이미지가\s*안전\s*검사에서\s*차단/i;

export function isV260807DetailPageJob(job: ManualDecisionJobLike) {
  const result = record(job.result);
  const plan = record(result.v3Plan);
  const engine = record(result.engineProfile);
  return Boolean(
    plan.schema_version === "detail_page_v3_plan" &&
      (plan.engine_id === "source-first-v3" || engine.id === "source-first-v3"),
  );
}

export function v260807ResumeReason(
  job: ManualDecisionJobLike,
): V260807ResumeReason {
  if (job.status !== "failed" || !isV260807DetailPageJob(job)) return null;
  const payload = record(job.payload);
  const failureText = [
    text(job.error),
    text(payload.recovery_stop_code),
    text(payload.recoveryStopCode),
  ].join(" ");

  if (/DETAIL_PAGE_AUTO_RECOVERY_EXHAUSTED/i.test(failureText)) {
    return "auto_recovery_exhausted";
  }
  if (
    SAFE_UNKNOWN_OUTCOME_STAGES.has(text(job.stage)) &&
    /DETAIL_PAGE_STEP_OUTCOME_UNKNOWN/i.test(failureText)
  ) {
    return "identity_review_outcome_unknown";
  }
  return null;
}

export function v260807GenerationSafetyBlocked(job: ManualDecisionJobLike) {
  return Boolean(
    job.status === "failed" &&
      isV260807DetailPageJob(job) &&
      text(job.stage) === "v3_generation" &&
      GENERATION_SAFETY_BLOCK_PATTERN.test(text(job.error)),
  );
}

export function v260807ManualDecisionKind(
  job: ManualDecisionJobLike,
): V260807ManualDecisionKind {
  if (job.status !== "failed" || !isV260807DetailPageJob(job)) return null;

  // Current infrastructure stop is authoritative. v260807 identity-review is a
  // read/verification step, so when its outcome is unknown we still avoid an
  // automatic retry, but allow the operator to resume from the durable
  // checkpoint. This does not allow unknown outcomes from paid generation
  // stages to be replayed.
  if (v260807ResumeReason(job)) {
    return "resume_checkpoint";
  }

  // A moderation/safety rejection occurs before the rejected image is stored.
  // It is therefore different from a later identity conflict: there is no bad
  // asset to approve, but the operator can choose a better 1688 identity anchor
  // and retry only the still-missing generation roles.
  if (v260807GenerationSafetyBlocked(job)) {
    return "generation_safety_block";
  }

  const result = record(job.result);
  const gate = record(result.v3RepresentativeIdentityGate);
  if (
    job.stage === "v3_representative_identity_failed" ||
    gate.status === "hard_identity_failed_after_retry"
  ) {
    return "identity_conflict";
  }
  return null;
}

export function v260807SourceAnchorSnapshot(
  job: ManualDecisionJobLike,
): V260807SourceAnchorSnapshot | null {
  if (!isV260807DetailPageJob(job)) return null;
  const result = record(job.result);
  const plan = record(result.v3Plan);
  const payload = record(job.payload);
  const evidenceUrls = stringList(payload.evidence_urls, 60);
  const evidenceNames = stringList(payload.evidence_names, 60);
  if (!evidenceUrls.length || plan.schema_version !== "detail_page_v3_plan") {
    return null;
  }
  const anchorIndex = boundedIndex(plan.identity_anchor_index, evidenceUrls.length);
  return {
    anchorIndex,
    anchorUrl: evidenceUrls[anchorIndex] || "",
    evidenceUrls,
    evidenceNames,
  };
}

export function v260807IdentitySnapshot(
  job: ManualDecisionJobLike,
): V260807IdentitySnapshot | null {
  if (v260807ManualDecisionKind(job) !== "identity_conflict") return null;
  const source = v260807SourceAnchorSnapshot(job);
  if (!source) return null;
  const result = record(job.result);
  const gate = record(result.v3RepresentativeIdentityGate);
  const failedRoleId = text(gate.failedRoleId || gate.failed_role_id);
  if (!REPRESENTATIVE_ROLES.has(failedRoleId)) return null;

  const representatives = array(result.v3Representatives);
  const failedRepresentative = representatives
    .map(record)
    .find((item) => text(item.roleId || item.role_id) === failedRoleId);

  return {
    ...source,
    failedRoleId,
    reason: text(gate.reason) || text(job.error),
    failedAssetUrl: safeUrl(
      failedRepresentative?.assetUrl ||
        failedRepresentative?.asset_url ||
        failedRepresentative?.url,
    ),
  };
}

export function canResumeV260807Checkpoint(job: ManualDecisionJobLike) {
  if (v260807ManualDecisionKind(job) !== "resume_checkpoint") return false;
  const result = record(job.result);
  const analysis = record(result.analysis);
  return Boolean(
    v260807SourceAnchorSnapshot(job) &&
      analysis.product &&
      record(result.v3Plan).schema_version === "detail_page_v3_plan",
  );
}

export function canRetryV260807GenerationSafety(job: ManualDecisionJobLike) {
  if (v260807ManualDecisionKind(job) !== "generation_safety_block") return false;
  const result = record(job.result);
  const analysis = record(result.analysis);
  return Boolean(
    v260807SourceAnchorSnapshot(job) &&
      analysis.product &&
      record(result.v3Plan).schema_version === "detail_page_v3_plan",
  );
}

export function canApproveV260807Identity(job: ManualDecisionJobLike) {
  const snapshot = v260807IdentitySnapshot(job);
  if (!snapshot) return false;
  const result = record(job.result);
  return (
    array(result.v3Representatives).filter((value) =>
      Boolean(safeUrl(record(value).assetUrl || record(value).asset_url)),
    ).length === 5
  );
}

export function isV260807RepresentativeRole(value: unknown) {
  return REPRESENTATIVE_ROLES.has(text(value));
}

function boundedIndex(value: unknown, length: number) {
  const number = Number(value);
  if (!Number.isInteger(number) || length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, number));
}

function stringList(value: unknown, max: number) {
  return array(value)
    .map(text)
    .filter(Boolean)
    .slice(0, max);
}

function safeUrl(value: unknown) {
  const candidate = text(value);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
