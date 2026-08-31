export type DependentCanonicalKey = "listingMappings" | "receiptCosts";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function dependentSkuContext<T extends { id: string }>(
  key: DependentCanonicalKey,
  rows: readonly unknown[],
  skuById: ReadonlyMap<string, T>,
): T[] {
  const skuIds = new Set<string>();
  for (const raw of rows) {
    const skuId = text(object(raw).skuId);
    if (!skuId) {
      throw new Error(`PRODUCT_MASTER_DEPENDENT_SKU_CONTEXT_MISSING:${key}:EMPTY`);
    }
    skuIds.add(skuId);
  }

  return [...skuIds].map((skuId) => {
    const sku = skuById.get(skuId);
    if (!sku) {
      throw new Error(
        `PRODUCT_MASTER_DEPENDENT_SKU_CONTEXT_MISSING:${key}:${skuId}`,
      );
    }
    return sku;
  });
}
