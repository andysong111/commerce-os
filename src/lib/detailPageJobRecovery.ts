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
  | { action: "dispatch"; nextRecoveryCount: number }
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

  const recoveryCount = nonNegativeInteger(payload.auto_recovery_count);
  if (recoveryCount >= DETAIL_PAGE_MAX_SAFE_AUTO_RECOVERIES) {
    return {
      action: "fail",
      code: "DETAIL_PAGE_AUTO_RECOVERY_EXHAUSTED",
      message:
        "안전한 자동 재개 한도를 사용해 작업을 중단했습니다. 저장된 마지막 단계에서 수동으로 다시 시작할 수 있습니다.",
    };
  }

  return { action: "dispatch", nextRecoveryCount: recoveryCount + 1 };
}

export function restoreManualRegenerationAssetsOnFailure(
  resultValue: unknown,
): Record<string, unknown> {
  const result = record(resultValue);
  const backup = record(result.manualRegenerationBackup);
  const representatives = Array.isArray(backup.representatives)
    ? backup.representatives
    : null;
  const panels = Array.isArray(backup.panels) ? backup.panels : null;
  if (representatives?.length && panels?.length) {
    return {
      lastAssetWork: result.assetWork ?? null,
      assetWork: null,
      manualRegenerationBackup: null,
      representatives,
      panels,
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function nonNegativeInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}
