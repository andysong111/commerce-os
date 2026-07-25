const ACCEPTED_TITLE_WRITE_STATUS = "api_accepted_manual_verification_required";

export function manualTitleTargetKey(goodsKey, mallKey) {
  return JSON.stringify([
    String(goodsKey ?? "").trim(),
    String(mallKey ?? "").trim(),
  ]);
}

export function isTerminalManualTitleResult(result) {
  const value = String(
    result?.phase ?? result?.status ?? result?.summary?.status ?? "",
  ).toLowerCase();
  return [
    "artifact_ready",
    "failed",
    "blocked",
    "completed_no_artifact",
    "error",
    "success",
    "partial_failure",
    "success_with_verification_warning",
    "partial_success_unverified",
  ].includes(value);
}

export function shouldPollRestoredManualTitle(session) {
  const requestId = String(
    session?.manualTitleRemainingRequestId ??
      session?.manualTitleCanaryRequestId ??
      session?.keywordRealApplyRequestId ??
      "",
  );
  if (!requestId) return false;
  const result = session?.manualTitleResult;
  const resultRequestId = String(result?.requestId ?? "");
  return !(
    resultRequestId === requestId && isTerminalManualTitleResult(result)
  );
}

export function collectAcceptedManualTitleTargetKeys(previousKeys, result) {
  const accepted = new Set(
    Array.isArray(previousKeys) ? previousKeys.map(String) : [],
  );
  for (const row of Array.isArray(result?.applyResults)
    ? result.applyResults
    : []) {
    if (String(row?.title_write_status ?? "") !== ACCEPTED_TITLE_WRITE_STATUS)
      continue;
    const goodsKey = String(row?.goods_key ?? row?.goodsKey ?? "").trim();
    const mallKey = String(row?.mall_key ?? row?.mallKey ?? "").trim();
    if (goodsKey && mallKey)
      accepted.add(manualTitleTargetKey(goodsKey, mallKey));
  }
  return [...accepted];
}

export function buildManualRemainingRetryExecutionPlan(
  eligibleItems,
  acceptedTargetKeys,
) {
  const items = Array.isArray(eligibleItems) ? eligibleItems : [];
  const accepted = new Set(
    Array.isArray(acceptedTargetKeys) ? acceptedTargetKeys.map(String) : [],
  );
  return JSON.stringify(
    items
      .filter(
        (item, index) =>
          index === 0 ||
          !accepted.has(manualTitleTargetKey(item.goods_key, item.mall_key)),
      )
      .map((item) => ({
        goods_key: item.goods_key,
        mall_key: item.mall_key,
        final_title: item.final_title,
        final_site_srch: item.final_site_srch,
      })),
  );
}

export function hasCompletedManualRemaining(
  acceptedTargetKeys,
  expectedTitleTargetCount,
) {
  return (
    new Set(Array.isArray(acceptedTargetKeys) ? acceptedTargetKeys : [])
      .size === Math.max(0, Number(expectedTitleTargetCount) - 1)
  );
}
