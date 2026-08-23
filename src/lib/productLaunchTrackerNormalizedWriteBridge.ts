import { NextRequest } from "next/server";
import { attachOptionBarcodeNosToChangedItems } from "@/lib/productLaunchOptionBarcodeRegistry";
import { withProductLaunchListSnapshot } from "@/lib/productLaunchTrackerListSnapshot";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  resolveProductLaunchIdentity,
  writeProductLaunchState,
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

  let row = (await readProductLaunchState(
    config.value,
    identity.value.userId,
  )) as StoredRow | null;
  if (!row || !isRecord(row.state_payload)) return;

  const changedIds = Array.isArray(asRecord(payload).changedIds)
    ? [...new Set((asRecord(payload).changedIds as unknown[]).map(text).filter(Boolean))]
    : [];
  const operation = text(asRecord(input).operation);

  let state = row.state_payload as ProductLaunchTrackerState;
  if (changedIds.length && operation !== "delete_items" && operation !== "update_policy") {
    state = await attachOptionBarcodeNosToChangedItems(
      config.value,
      identity.value.userId,
      state,
      changedIds,
    );
    state = withProductLaunchListSnapshot(state);
    row = (await writeProductLaunchState(
      config.value,
      identity.value,
      state,
    )) as StoredRow;
  }

  if (!changedIds.length || operation === "update_policy") {
    await syncProductLaunchNormalizedFull(
      config.value,
      identity.value,
      state,
      row.updated_at,
    );
    return;
  }

  const result = await syncProductLaunchNormalizedChangedItems(
    config.value,
    identity.value,
    state,
    row.updated_at,
    changedIds,
  );
  if (result.synced === false) {
    await syncProductLaunchNormalizedFull(
      config.value,
      identity.value,
      state,
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
