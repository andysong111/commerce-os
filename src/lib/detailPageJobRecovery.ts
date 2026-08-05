export const DETAIL_PAGE_STAGED_PIPELINE_VERSION = "asset-stages-v2";

export const DETAIL_PAGE_MAX_SAFE_AUTO_RECOVERIES = 1;

export type DetailPageRecoveryJob = {
  status: string;
  stage: string;
  lease_owner?: string;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
};

export type DetailPageRecoveryDecision =
  | {
      action: "dispatch";
      nextRecoveryCount: number;
      recoveryScope: string;
    }
  | { action: "fail"; code: string; message: string };

export function matchesDetailPageExecution(
  job: Pick<DetailPageRecoveryJob, "payload">,
  executionIdValue: unknown,
) {
  const payload = record(job.payload);
  if (text(payload.pipeline_version) !== DETAIL_PAGE_STAGED_PIPELINE_VERSION) {
    return true;
  }
  const expectedExecutionId = text(payload.execution_id);
  return Boolean(expectedExecutionId) && text(executionIdValue) === expectedExecutionId;
}

export function detailPageRecoveryScope(job: DetailPageRecoveryJob) {
  const result = record(job.result);
  const assetWork = record(result.assetWork);
  const stage = text(job.stage) || "unknown";
  const assetTarget =
    text(assetWork.roleId || assetWork.role_id) ||
    (positiveInteger(assetWork.slot) ? `panel-${positiveInteger(assetWork.slot)}` : "");
  const assetScope = [
    text(assetWork.phase),
    text(assetWork.kind),
    assetTarget,
    String(positiveInteger(assetWork.generationAttempt) || 0),
  ].join(":");
  const representativeRoles = array(result.representatives)
    .map((value) => text(record(value).roleId || record(value).role_id || record(value).role))
    .filter(Boolean)
    .sort()
    .join(",");
  const panelSlots = array(result.panels || result.detailPanels || result.detail_panels)
    .map((value) => positiveInteger(record(value).slot))
    .filter((value) => value > 0)
    .sort((left, right) => left - right)
    .join(",");
  const retryScope = [
    text(result.representativeRetryRole),
    array(result.panelRetrySlots)
      .map(positiveInteger)
      .filter((value) => value > 0)
      .sort((left, right) => left - right)
      .join(","),
    text(record(result.setAssessment).status),
  ].join(":");

  return [
    stage,
    assetScope,
    `representatives=${representativeRoles}`,
    `panels=${panelSlots}`,
    `retry=${retryScope}`,
  ].join("|");
}

export function detailPageRecoveryDecision(
  job: DetailPageRecoveryJob,
): DetailPageRecoveryDecision {
  const payload = record(job.payload);
  if (text(payload.pipeline_version) !== DETAIL_PAGE_STAGED_PIPELINE_VERSION) {
    return {
      action: "fail",
      code: "DETAIL_PAGE_LEGACY_STALLED_STOPPED",
      message:
        "이전 방식에서 정체된 작업을 비용 보호를 위해 중단했습니다. 저장 체크포인트에서 부분 재생성을 다시 시작할 수 있습니다.",
    };
  }

  const assetWork = record(record(job.result).assetWork);
  const safelyRepeatableQa =
    text(assetWork.phase) === "qa_running" &&
    Boolean(text(assetWork.candidateUrl));
  if (text(job.lease_owner) && !safelyRepeatableQa) {
    return {
      action: "fail",
      code: "DETAIL_PAGE_STEP_OUTCOME_UNKNOWN",
      message:
        "AI 단계의 성공 여부를 확인할 수 없어 자동 재결제를 차단했습니다. 저장된 자산은 유지됩니다.",
    };
  }

  const recoveryScope = detailPageRecoveryScope(job);
  const previousScope = text(payload.auto_recovery_scope);
  const recoveryCount =
    previousScope === recoveryScope
      ? nonNegativeInteger(payload.auto_recovery_count)
      : 0;
  if (recoveryCount >= DETAIL_PAGE_MAX_SAFE_AUTO_RECOVERIES) {
    return {
      action: "fail",
      code: "DETAIL_PAGE_AUTO_RECOVERY_EXHAUSTED",
      message:
        "현재 저장 단계의 안전한 자동 재개 한도를 사용해 작업을 중단했습니다. 저장된 마지막 단계에서 수동으로 다시 시작할 수 있습니다.",
    };
  }

  return {
    action: "dispatch",
    nextRecoveryCount: recoveryCount + 1,
    recoveryScope,
  };
}

export function restoreManualRegenerationAssetsOnFailure(
  resultValue: unknown,
): Record<string, unknown> {
  const result = record(resultValue);
  const backup = record(result.manualRegenerationBackup);
  const backupRepresentatives = arrayOrNull(backup.representatives);
  const backupPanels = arrayOrNull(backup.panels);
  if (backupRepresentatives?.length && backupPanels?.length) {
    return {
      lastAssetWork: result.assetWork ?? null,
      assetWork: null,
      manualRegenerationBackup: null,
      representatives: mergeAssetRecords(
        backupRepresentatives,
        array(result.representatives),
        representativeIdentity,
      ),
      panels: mergeAssetRecords(
        backupPanels,
        array(result.panels || result.detailPanels || result.detail_panels),
        panelIdentity,
      ),
      detailImageUrl: backup.detailImageUrl ?? result.detailImageUrl,
      mainImageUrl: backup.mainImageUrl ?? result.mainImageUrl,
      additionalImageUrls:
        backup.additionalImageUrls ?? result.additionalImageUrls,
    };
  }
  return restorePublishedRepresentativeRecords(result);
}

const PUBLISHED_REPRESENTATIVE_ROLES = [
  { roleId: "main_catalog", order: 1, labelKo: "대표 · 카탈로그" },
  { roleId: "alternate_whole", order: 2, labelKo: "부가 1 · 전체 형태" },
  { roleId: "evidence_detail", order: 3, labelKo: "부가 2 · 소재·구조" },
  { roleId: "lifestyle_usage", order: 4, labelKo: "부가 3 · 사용 장면" },
  { roleId: "adaptive_support", order: 5, labelKo: "부가 4 · 맞춤 구매 근거" },
] as const;

function restorePublishedRepresentativeRecords(
  result: Record<string, unknown>,
): Record<string, unknown> {
  const mainImageUrl = text(result.mainImageUrl);
  const additionalImageUrls = Array.isArray(result.additionalImageUrls)
    ? result.additionalImageUrls.map(text).slice(0, 4)
    : [];
  const urls = [mainImageUrl, ...additionalImageUrls];
  if (urls.length !== PUBLISHED_REPRESENTATIVE_ROLES.length || urls.some((url) => !url)) {
    return {};
  }

  const existing = Array.isArray(result.representatives)
    ? result.representatives.map(record)
    : [];
  const byRole = new Map(
    existing
      .map((item) => [text(item.roleId || item.role_id), item] as const)
      .filter(([roleId]) => Boolean(roleId)),
  );
  if (PUBLISHED_REPRESENTATIVE_ROLES.every(({ roleId }) => byRole.has(roleId))) {
    return {};
  }

  return {
    lastAssetWork: result.assetWork ?? null,
    assetWork: null,
    manualRegenerationBackup: null,
    representatives: PUBLISHED_REPRESENTATIVE_ROLES.map((role, index) =>
      byRole.get(role.roleId) ?? {
        ...role,
        status: "ready",
        assetUrl: urls[index],
        mimeType: "image/jpeg",
        restoredFromPublishedAsset: true,
      },
    ),
  };
}

function mergeAssetRecords(
  backupValues: unknown[],
  currentValues: unknown[],
  identity: (value: unknown) => string,
) {
  const merged = new Map<string, unknown>();
  for (const value of backupValues) {
    const key = identity(value);
    if (key) merged.set(key, value);
  }
  for (const value of currentValues) {
    const key = identity(value);
    if (!key) continue;
    const current = record(value);
    const backup = record(merged.get(key));
    if (hasStableAsset(current) || !Object.keys(backup).length) {
      merged.set(key, value);
    }
  }
  return [...merged.values()];
}

function representativeIdentity(value: unknown) {
  const item = record(value);
  return text(item.roleId || item.role_id || item.role);
}

function panelIdentity(value: unknown) {
  const item = record(value);
  const slot = positiveInteger(item.slot || item.sectionSlot || item.section_slot);
  return slot ? `panel-${slot}` : "";
}

function hasStableAsset(value: Record<string, unknown>) {
  return Boolean(
    text(
      value.assetUrl ||
        value.asset_url ||
        value.imageUrl ||
        value.image_url ||
        value.panelUrl ||
        value.panel_url ||
        value.url,
    ),
  );
}

function arrayOrNull(value: unknown) {
  return Array.isArray(value) ? value : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function nonNegativeInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}
