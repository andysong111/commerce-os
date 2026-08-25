import {
  readProductLaunchState,
  type ProductLaunchAdminConfig,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";
import {
  syncProductLaunchNormalizedChangedItems,
  syncProductLaunchNormalizedFull,
} from "@/lib/productLaunchTrackerNormalizedStore";
import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";

type StoredRow = { state_payload?: unknown; updated_at?: unknown };

export async function reconcileProductLaunchNormalizedAfterLegacyItems(
  config: ProductLaunchAdminConfig,
  identity: ProductLaunchIdentity,
  itemIds: string[],
) {
  const changedIds = [...new Set(itemIds.map(text).filter(Boolean))];
  if (!changedIds.length) return { synced: false, reason: "no_changed_items" as const };

  const row = (await readProductLaunchState(
    config,
    identity.userId,
  )) as StoredRow | null;
  if (!row || !isRecord(row.state_payload)) {
    return { synced: false, reason: "state_not_found" as const };
  }

  const state = row.state_payload as ProductLaunchTrackerState;
  const result = await syncProductLaunchNormalizedChangedItems(
    config,
    identity,
    state,
    row.updated_at,
    changedIds,
  );
  if (result.synced === false) {
    const full = await syncProductLaunchNormalizedFull(
      config,
      identity,
      state,
      row.updated_at,
    );
    return { synced: true, mode: "full" as const, ...full };
  }

  return { synced: true, mode: "changed" as const, ...result };
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
