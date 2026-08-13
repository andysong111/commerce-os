import { NextRequest } from "next/server";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  resolveProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";
import {
  setProductLaunchNormalizedReadEnabled,
  syncProductLaunchNormalizedFull,
} from "@/lib/productLaunchTrackerNormalizedStore";
import type { ProductLaunchTrackerState } from "@/lib/productLaunchTrackerOptimized";
import { GET as legacyGet, PUT as legacyPut } from "../state/route";

type StoredRow = {
  state_payload?: unknown;
  updated_at?: unknown;
};

export async function GET(request: NextRequest) {
  return legacyGet(request);
}

export async function PUT(request: NextRequest) {
  const response = await legacyPut(request);
  if (!response.ok) return response;

  try {
    const identity = await resolveProductLaunchIdentity(request);
    if (!identity.ok) return response;
    const config = getProductLaunchAdminConfig();
    if (!config.ok) return response;

    const row = (await readProductLaunchState(
      config.value,
      identity.value.userId,
    )) as StoredRow | null;
    if (!row || !isRecord(row.state_payload)) return response;

    await syncProductLaunchNormalizedFull(
      config.value,
      identity.value,
      row.state_payload as ProductLaunchTrackerState,
      row.updated_at,
    );
  } catch (error) {
    console.error(
      "[product-launch-normalized-state] legacy write kept; normalized read disabled",
      error,
    );
    await disableNormalizedRead(request);
  }

  return response;
}

async function disableNormalizedRead(request: NextRequest) {
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
    // The legacy JSON state remains authoritative.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
