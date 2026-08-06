export const DETAIL_PAGE_ASSET_ROLE_PATTERN =
  /^(detail-page|main|additional-[1-4]|evidence-(?:[1-9]|[1-5][0-9]|60)|panel-[1-8])$/;

const V3_ROLE_TO_EXISTING_STORAGE_ROLE: Record<string, string> = {
  "v3-representative-main-catalog": "main",
  "v3-representative-alternate-whole": "additional-1",
  "v3-representative-evidence-detail": "additional-2",
  "v3-representative-lifestyle-usage": "additional-3",
  "v3-representative-adaptive-support": "additional-4",
  "v3-hook": "panel-1",
  "v3-point-1-filler": "panel-2",
  "v3-point-2-filler": "panel-3",
  "v3-point-3-filler": "panel-4",
  "v3-usage-filler-1": "panel-5",
  "v3-usage-filler-2": "panel-6",
  "v3-option-filler": "panel-7",
};

export function normalizeDetailPageAssetRole(value: unknown) {
  const requested = String(value ?? "").trim();
  return V3_ROLE_TO_EXISTING_STORAGE_ROLE[requested] ?? requested;
}

export function isAllowedDetailPageAssetRole(value: unknown) {
  return DETAIL_PAGE_ASSET_ROLE_PATTERN.test(
    normalizeDetailPageAssetRole(value),
  );
}
