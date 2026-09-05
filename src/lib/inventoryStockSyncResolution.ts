import type {
  ShoplingStockDesiredStatus,
  ShoplingStockSyncEvent,
} from "@/lib/inventoryStockControl";

export function latestRelevantShoplingSync(
  events: ShoplingStockSyncEvent[],
  desiredStatus: ShoplingStockDesiredStatus,
  desiredSince: string,
) {
  const relevant = events
    .filter(
      (event) =>
        event.desiredStatus === desiredStatus &&
        event.occurredAt >= desiredSince,
    )
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  return relevant[relevant.length - 1] ?? null;
}

export function isUnresolvedShoplingSync(
  latest: ShoplingStockSyncEvent | null,
) {
  return Boolean(
    latest &&
      (latest.outcome === "STARTED" || latest.outcome === "UNCERTAIN"),
  );
}
