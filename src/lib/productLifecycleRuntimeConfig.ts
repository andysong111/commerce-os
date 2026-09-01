import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const PRODUCT_LIFECYCLE_RUNTIME_CONFIG_TABLE = "product_lifecycle_runtime_config";
export const DEFAULT_SHOPLING_LIVE_BATCH_LIMIT = 10;
export const MAX_SHOPLING_LIVE_BATCH_LIMIT = 100;

export type ProductLifecycleRuntimeConfig = {
  shoplingNonDestructiveLive: boolean;
  purchaseStopLive: boolean;
  deleteLive: boolean;
  shoplingLiveBatchLimit: number;
  source: "database" | "legacy_env" | "default_shadow";
};

type AdminClient = NonNullable<Awaited<ReturnType<typeof createSupabaseAdminClient>>>;

function batchLimit(value: unknown) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_SHOPLING_LIVE_BATCH_LIMIT;
  return Math.max(1, Math.min(MAX_SHOPLING_LIVE_BATCH_LIMIT, parsed));
}

export async function loadProductLifecycleRuntimeConfig(
  admin: AdminClient,
): Promise<ProductLifecycleRuntimeConfig> {
  const result = await admin
    .from(PRODUCT_LIFECYCLE_RUNTIME_CONFIG_TABLE)
    .select("config_key,shopling_non_destructive_live,purchase_stop_live,delete_live,shopling_live_batch_limit")
    .eq("config_key", "default")
    .limit(1);

  if (!result.error && Array.isArray(result.data) && result.data[0]) {
    const row = result.data[0] as Record<string, unknown>;
    return {
      shoplingNonDestructiveLive: row.shopling_non_destructive_live === true,
      purchaseStopLive: row.purchase_stop_live === true,
      deleteLive: row.delete_live === true,
      shoplingLiveBatchLimit: batchLimit(row.shopling_live_batch_limit),
      source: "database",
    };
  }

  if (result.error && result.error.code !== "42P01") {
    throw new Error(`PRODUCT_LIFECYCLE_RUNTIME_CONFIG_FAILED:${result.error.message}`);
  }

  if (process.env.PRODUCT_LIFECYCLE_ENFORCEMENT_MODE?.trim().toLowerCase() === "live") {
    return {
      shoplingNonDestructiveLive: true,
      purchaseStopLive: true,
      deleteLive: false,
      shoplingLiveBatchLimit: DEFAULT_SHOPLING_LIVE_BATCH_LIMIT,
      source: "legacy_env",
    };
  }

  return {
    shoplingNonDestructiveLive: false,
    purchaseStopLive: false,
    deleteLive: false,
    shoplingLiveBatchLimit: DEFAULT_SHOPLING_LIVE_BATCH_LIMIT,
    source: "default_shadow",
  };
}
