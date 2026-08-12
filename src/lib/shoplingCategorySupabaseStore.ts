import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  getProductLaunchAdminConfig,
  readResponseJson,
  readProductLaunchError,
} from "@/lib/productLaunchTrackerServer";
import type {
  ShoplingCategoryRefreshStatus,
  ShoplingCategorySnapshot,
} from "@/lib/shoplingCategoryCatalog";
import { sanitizeShoplingCategorySnapshot } from "@/lib/shoplingCategorySnapshotSafety";

const SYSTEM_OWNER_ID = "7fcb0ac2-cc25-4f0a-a2d9-6f94fbdb7b91";
const SYSTEM_OWNER_EMAIL = "system+shopling-categories@commerce-os.local";
const SYSTEM_KIND = "shopling_category_catalog";
const SYSTEM_SCHEMA_VERSION = 1;

type StoredPayload = {
  kind?: unknown;
  snapshot?: unknown;
  status?: unknown;
};

function adminConfig() {
  const result = getProductLaunchAdminConfig();
  if (!result.ok) throw new Error(result.body.message);
  return result.value;
}

function normalizeStoredCatalog(payload: StoredPayload) {
  const snapshot = sanitizeShoplingCategorySnapshot(
    payload.snapshot,
  ) as ShoplingCategorySnapshot | null;
  const rawStatus =
    payload.status && typeof payload.status === "object"
      ? (payload.status as ShoplingCategoryRefreshStatus)
      : null;
  const status = rawStatus
    ? {
        ...rawStatus,
        ...(snapshot
          ? {
              categoryCount: snapshot.categoryCount,
              hash: snapshot.hash,
            }
          : {}),
      }
    : null;
  return { snapshot, status };
}

export async function readShoplingCategoryCatalogFromSupabase(): Promise<{
  snapshot: ShoplingCategorySnapshot | null;
  status: ShoplingCategoryRefreshStatus | null;
}> {
  const config = adminConfig();
  const params = new URLSearchParams({
    select: "state_payload,updated_at",
    owner_id: `eq.${SYSTEM_OWNER_ID}`,
    limit: "1",
  });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/product_launch_tracker_states?${params.toString()}`,
    {
      headers: createSupabaseAdminHeaders(config.secretKey),
      cache: "no-store",
    },
  );
  const body = await readResponseJson(response);
  if (!response.ok) {
    throw new Error(readProductLaunchError(body, response.status));
  }
  const row = Array.isArray(body) ? body[0] : null;
  if (!row || typeof row !== "object") {
    return { snapshot: null, status: null };
  }
  const payload = (row as { state_payload?: StoredPayload }).state_payload;
  if (!payload || typeof payload !== "object" || payload.kind !== SYSTEM_KIND) {
    return { snapshot: null, status: null };
  }
  return normalizeStoredCatalog(payload);
}

export async function writeShoplingCategoryCatalogToSupabase(input: {
  snapshot: ShoplingCategorySnapshot;
  status: ShoplingCategoryRefreshStatus;
}) {
  const config = adminConfig();
  const now = new Date().toISOString();
  const snapshot = sanitizeShoplingCategorySnapshot(
    input.snapshot,
  ) as ShoplingCategorySnapshot | null;
  if (!snapshot) {
    throw new Error("저장할 샵플링 카테고리 스냅샷이 비어 있습니다.");
  }
  const status: ShoplingCategoryRefreshStatus = {
    ...input.status,
    categoryCount: snapshot.categoryCount,
    hash: snapshot.hash,
  };
  const row = {
    owner_id: SYSTEM_OWNER_ID,
    owner_email: SYSTEM_OWNER_EMAIL,
    schema_version: SYSTEM_SCHEMA_VERSION,
    state_payload: {
      kind: SYSTEM_KIND,
      snapshot,
      status,
      updatedAt: now,
    },
    updated_at: now,
  };
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/product_launch_tracker_states?on_conflict=owner_id`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(row),
      cache: "no-store",
    },
  );
  const body = await readResponseJson(response);
  if (!response.ok) {
    throw new Error(readProductLaunchError(body, response.status));
  }
  return Array.isArray(body) ? body[0] ?? row : row;
}

export const SHOPLING_CATEGORY_SYSTEM_OWNER_ID = SYSTEM_OWNER_ID;
