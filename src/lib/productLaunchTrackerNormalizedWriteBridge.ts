import { NextRequest } from "next/server";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  resolveProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";
import {
  setProductLaunchNormalizedReadEnabled,
  syncProductLaunchNormalizedChangedItems,
  syncProductLaunchNormalizedFull,
} from "@/lib/productLaunchTrackerNormalizedStore";
import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";

type StoredRow = { state_payload?: unknown; updated_at?: unknown };

export async function syncProductLaunchNormalizedAfterMutation(
  request: NextRequest,
  input: unknown,
  payload: unknown,
) {
  const identity = await resolveProductLaunchIdentity(request);
  if (!identity.ok) return;
  const config = getProductLaunchAdminConfig();
  if (!config.ok) return;

  const row = (await readProductLaunchState(
    config.value,
    identity.value.userId,
  )) as StoredRow | null;
  if (!row || !isRecord(row.state_payload)) return;

  const changedIds = Array.isArray(asRecord(payload).changedIds)
    ? [...new Set((asRecord(payload).changedIds as unknown[]).map(text).filter(Boolean))]
    : [];
  const operation = text(asRecord(input).operation);

  if (!changedIds.length || operation === "update_policy") {
    await syncProductLaunchNormalizedFull(
      config.value,
      identity.value,
      row.state_payload as ProductLaunchTrackerState,
      row.updated_at,
    );
    return;
  }

  const result = await syncProductLaunchNormalizedChangedItems(
    config.value,
    identity.value,
    row.state_payload as ProductLaunchTrackerState,
    row.updated_at,
    changedIds,
  );
  if (result.synced === false) {
    await syncProductLaunchNormalizedFull(
      config.value,
      identity.value,
      row.state_payload as ProductLaunchTrackerState,
      row.updated_at,
    );
  }
}

export async function disableProductLaunchNormalizedRead(request: NextRequest) {
  try {
    const identity = await resolveProductLaunchIdentity(request);
    if (!identity.ok) return;
    const config = getProductLaunchAdminConfig();
    if (!config.ok) return;
    await setProductLaunchNormalizedReadEnabled(
      config.value,
      identity.value.userId,
      false,
    );
  } catch {
    // Legacy JSON remains authoritative.
  }
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
