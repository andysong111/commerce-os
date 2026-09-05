import type {
  InventoryStockControlReport,
  ShoplingStockDesiredStatus,
  ShoplingStockSyncEvent,
} from "@/lib/inventoryStockControl";

const STALE_UNRESOLVED_REASON =
  "이전 Shopling 실행이 STARTED/UNCERTAIN 상태라 중복 실행을 차단했습니다.";

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

export function normalizeRetryableShoplingSyncReport(
  report: InventoryStockControlReport,
): InventoryStockControlReport {
  let changed = false;
  const rows = report.rows.map((row) => {
    const staleFailedBlock =
      row.syncNeeded &&
      row.syncBlocked &&
      row.latestSyncOutcome === "FAILED" &&
      row.syncBlockReason === STALE_UNRESOLVED_REASON;
    if (!staleFailedBlock) return row;
    changed = true;
    return {
      ...row,
      syncBlocked: false,
      syncBlockReason: null,
    };
  });
  if (!changed) return report;
  return {
    ...report,
    rows,
    pendingSyncCount: rows.filter(
      (row) => row.syncNeeded && !row.syncBlocked,
    ).length,
  };
}
