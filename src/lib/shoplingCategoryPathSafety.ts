export const SHOPLING_INVENTORY_PSEUDO_CATEGORY_NAMES = [
  "실재고",
  "안전재고",
  "임의재고",
] as const;

const INVENTORY_PSEUDO_CATEGORY_SET = new Set<string>(
  SHOPLING_INVENTORY_PSEUDO_CATEGORY_NAMES,
);

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function splitShoplingCategoryPath(value: unknown) {
  return text(value)
    .split(/\s*>\s*/g)
    .map(text)
    .filter(Boolean);
}

export function isShoplingInventoryPseudoCategoryName(value: unknown) {
  return INVENTORY_PSEUDO_CATEGORY_SET.has(text(value));
}

export function sanitizeShoplingCategoryPath(value: unknown) {
  const parts = splitShoplingCategoryPath(value);
  while (
    parts.length &&
    isShoplingInventoryPseudoCategoryName(parts.at(-1))
  ) {
    parts.pop();
  }
  return parts.join(">");
}

export function hasShoplingInventoryPseudoCategorySegment(value: unknown) {
  return splitShoplingCategoryPath(value).some(
    isShoplingInventoryPseudoCategoryName,
  );
}

export function sanitizeShoplingCategoryPathArray(
  value: unknown,
  limit = 50_000,
) {
  const source = Array.isArray(value) ? value : [];
  const unique: string[] = [];
  for (const raw of source) {
    const sanitized = sanitizeShoplingCategoryPath(raw);
    if (!sanitized || unique.includes(sanitized)) continue;
    unique.push(sanitized);
    if (unique.length >= Math.max(1, limit)) break;
  }
  return unique;
}
