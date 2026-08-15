type UnknownRecord = Record<string, unknown>;

export function isDetailPageStageCompleted(value: unknown) {
  const item = record(value);
  const stages = record(item.stages);
  const detailPage = record(stages.detailPage);
  return text(detailPage.status) === "완료";
}

export function hasUsableDetailPageMaterials(value: unknown) {
  const item = record(value);
  const asset = record(item.detailPageAsset);
  return Boolean(text(asset.html) && text(asset.mainImageUrl));
}

export function shouldResetDetailPageStage(value: unknown) {
  return isDetailPageStageCompleted(value) && !hasUsableDetailPageMaterials(value);
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return typeof value === "string"
    ? value.trim()
    : value == null
      ? ""
      : String(value).trim();
}
