export type V260807ManualDecisionKind =
  | "resume_checkpoint"
  | "identity_conflict"
  | null;

export type ManualDecisionJobLike = {
  status: string;
  stage: string;
  error?: string;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
};

export type V260807IdentitySnapshot = {
  failedRoleId: string;
  reason: string;
  anchorIndex: number;
  anchorUrl: string;
  failedAssetUrl: string;
  evidenceUrls: string[];
  evidenceNames: string[];
};

const REPRESENTATIVE_ROLES = new Set([
  "main_catalog",
  "alternate_whole",
  "evidence_detail",
  "lifestyle_usage",
  "adaptive_support",
]);

export function isV260807DetailPageJob(job: ManualDecisionJobLike) {
  const result = record(job.result);
  const plan = record(result.v3Plan);
  const engine = record(result.engineProfile);
  return Boolean(
    plan.schema_version === "detail_page_v3_plan" &&
      (plan.engine_id === "source-first-v3" || engine.id === "source-first-v3"),
  );
}

export function v260807ManualDecisionKind(
  job: ManualDecisionJobLike,
): V260807ManualDecisionKind {
  if (job.status !== "failed" || !isV260807DetailPageJob(job)) return null;

  const payload = record(job.payload);
  const failureText = [
    text(job.error),
    text(payload.recovery_stop_code),
    text(payload.recoveryStopCode),
  ].join(" ");
  // The current terminal failure is authoritative. A previous identity-gate
  // result may remain in the merged checkpoint after a later infrastructure
  // recovery stop, so handle explicit recovery exhaustion first.
  if (/DETAIL_PAGE_AUTO_RECOVERY_EXHAUSTED/i.test(failureText)) {
    return "resume_checkpoint";
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

export function v260807IdentitySnapshot(
  job: ManualDecisionJobLike,
): V260807IdentitySnapshot | null {
  if (v260807ManualDecisionKind(job) !== "identity_conflict") return null;
  const result = record(job.result);
  const gate = record(result.v3RepresentativeIdentityGate);
  const plan = record(result.v3Plan);
  const payload = record(job.payload);
  const failedRoleId = text(gate.failedRoleId || gate.failed_role_id);
  if (!REPRESENTATIVE_ROLES.has(failedRoleId)) return null;

  const evidenceUrls = stringList(payload.evidence_urls, 60);
  const evidenceNames = stringList(payload.evidence_names, 60);
  const anchorIndex = boundedIndex(plan.identity_anchor_index, evidenceUrls.length);
  const representatives = array(result.v3Representatives);
  const failedRepresentative = representatives
    .map(record)
    .find((item) => text(item.roleId || item.role_id) === failedRoleId);

  return {
    failedRoleId,
    reason: text(gate.reason) || text(job.error),
    anchorIndex,
    anchorUrl: evidenceUrls[anchorIndex] || "",
    failedAssetUrl: safeUrl(
      failedRepresentative?.assetUrl ||
        failedRepresentative?.asset_url ||
        failedRepresentative?.url,
    ),
    evidenceUrls,
    evidenceNames,
  };
}

export function canResumeV260807Checkpoint(job: ManualDecisionJobLike) {
  if (v260807ManualDecisionKind(job) !== "resume_checkpoint") return false;
  const payload = record(job.payload);
  const result = record(job.result);
  const analysis = record(result.analysis);
  return Boolean(
    stringList(payload.evidence_urls, 60).length > 0 &&
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
