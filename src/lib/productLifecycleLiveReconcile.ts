import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import {
  loadProductLifecycleRuntimeConfig,
  type ProductLifecycleRuntimeConfig,
} from "@/lib/productLifecycleRuntimeConfig";
import { loadShoplingLifecycleStatusSnapshot } from "@/lib/shopling/shoplingLifecycleStatus";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const STATE_TABLE = "product_lifecycle_states";
const QUEUE_TABLE = "shopling_lifecycle_action_queue";
const OPERATION_TYPE = "PRODUCT_LIFECYCLE_LIVE_RECONCILE";
const SOURCE = "ops-center-product-lifecycle-live-reconcile";
const MAX_PRODUCTS = 10_000;

type LifecycleStateRow = {
  sku_id?: unknown;
  barcode?: unknown;
  lifecycle_state?: unknown;
  desired_shopling_state?: unknown;
  requires_review?: unknown;
  reason_codes?: unknown;
  evidence?: unknown;
};

type AdminClient = NonNullable<Awaited<ReturnType<typeof createSupabaseAdminClient>>>;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function reasons(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : [];
}

function listingGoodsKeys(product: { listings?: Array<{ goodsKey?: string | null; active?: boolean }> }) {
  return [...new Set(
    (product.listings ?? [])
      .filter((listing) => listing.active !== false)
      .map((listing) => text(listing.goodsKey))
      .filter((value) => /^\d{5,9}$/.test(value)),
  )];
}

function desiredSaleStatus(value: unknown) {
  const desired = text(value).toUpperCase();
  if (desired === "SELLING") return "B";
  if (desired === "SOLD_OUT") return "C";
  return "";
}

function currentHourKey(now: string) {
  return now.slice(0, 13).replace(/[:T]/g, "-");
}

export type ProductLifecycleLiveReconcileSummary = {
  generatedAt: string;
  config: ProductLifecycleRuntimeConfig;
  purchaseGateApplied: boolean;
  shoplingWriteGateEnabled: boolean;
  productCount: number;
  listingCount: number;
  observedReadyCount: number;
  alreadyAlignedCount: number;
  wouldQueueMismatchCount: number;
  queuedMismatchCount: number;
  unresolvedCount: number;
  blockedQueueSkippedCount: number;
  deleteQueuedCount: 0;
};

export async function runProductLifecycleLiveReconcile(
  nowValue: Date | string = new Date(),
): Promise<ProductLifecycleLiveReconcileSummary> {
  const nowDate = nowValue instanceof Date ? new Date(nowValue) : new Date(nowValue);
  if (!Number.isFinite(nowDate.valueOf())) throw new Error("PRODUCT_LIFECYCLE_RECONCILE_NOW_INVALID");
  const generatedAt = nowDate.toISOString();
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");

  const config = await loadProductLifecycleRuntimeConfig(admin);
  const [planning, statesResult, blockingQueueResult] = await Promise.all([
    loadProductPlanningSnapshot(),
    admin
      .from(STATE_TABLE)
      .select("sku_id,barcode,lifecycle_state,desired_shopling_state,requires_review,reason_codes,evidence")
      .limit(MAX_PRODUCTS),
    admin
      .from(QUEUE_TABLE)
      .select("goods_key,desired_state,status")
      .eq("shadow_mode", false)
      .in("status", ["pending", "claimed", "failed", "confirm_needed"])
      .limit(MAX_PRODUCTS),
  ]);

  if (planning.products.length > MAX_PRODUCTS) {
    throw new Error(`PRODUCT_LIFECYCLE_RECONCILE_PRODUCT_LIMIT_EXCEEDED:${planning.products.length}`);
  }
  if (statesResult.error) throw new Error(`PRODUCT_LIFECYCLE_RECONCILE_STATE_READ_FAILED:${statesResult.error.message}`);
  if (blockingQueueResult.error) throw new Error(`PRODUCT_LIFECYCLE_RECONCILE_QUEUE_READ_FAILED:${blockingQueueResult.error.message}`);

  const stateRows = (Array.isArray(statesResult.data) ? statesResult.data : []) as LifecycleStateRow[];
  const statesBySku = new Map(stateRows.map((row) => [text(row.sku_id), row] as const));
  const blockingGoodsKeys = new Set(
    (Array.isArray(blockingQueueResult.data) ? blockingQueueResult.data : [])
      .map((row) => text(row.goods_key))
      .filter((value) => /^\d{5,9}$/.test(value)),
  );

  const eligibleProducts = planning.products
    .map((product) => ({ product, state: statesBySku.get(text(product.skuId)) }))
    .filter(({ state }) => {
      if (!state || state.requires_review === true) return false;
      return Boolean(desiredSaleStatus(state.desired_shopling_state));
    });
  const allGoodsKeys = [...new Set(eligibleProducts.flatMap(({ product }) => listingGoodsKeys(product)))];
  const snapshot = await loadShoplingLifecycleStatusSnapshot(allGoodsKeys);
  const observedByGoodsKey = new Map(snapshot.statuses.map((row) => [row.goodsKey, row] as const));
  const mismatchRows: Array<Record<string, unknown>> = [];

  let observedReadyCount = 0;
  let alreadyAlignedCount = 0;
  let unresolvedCount = 0;
  let blockedQueueSkippedCount = 0;

  for (const { product, state } of eligibleProducts) {
    if (!state) continue;
    const desiredCode = desiredSaleStatus(state.desired_shopling_state);
    const desiredState = text(state.desired_shopling_state).toUpperCase();
    if (!desiredCode || !["SELLING", "SOLD_OUT"].includes(desiredState)) continue;

    for (const goodsKey of listingGoodsKeys(product)) {
      if (blockingGoodsKeys.has(goodsKey)) {
        blockedQueueSkippedCount += 1;
        continue;
      }

      const observed = observedByGoodsKey.get(goodsKey);
      if (!observed || observed.state !== "READY") {
        unresolvedCount += 1;
        continue;
      }
      observedReadyCount += 1;
      const current = text(observed.currentSaleStatus).toUpperCase();
      if (current === desiredCode) {
        alreadyAlignedCount += 1;
        continue;
      }

      // Initial live scope is deliberately restricted to the field-tested reversible B <-> C path.
      // A/D/E/Z/unknown states remain fail-closed for human review instead of being auto-mutated.
      if (!["B", "C"].includes(current)) {
        unresolvedCount += 1;
        continue;
      }

      const stateEvidence = object(state.evidence);
      mismatchRows.push({
        dedupe_key: [
          "live-reconcile",
          text(state.sku_id),
          goodsKey,
          current,
          desiredState,
          currentHourKey(generatedAt),
        ].join(":"),
        sku_id: text(state.sku_id),
        barcode: text(state.barcode).toUpperCase(),
        goods_key: goodsKey,
        desired_state: desiredState,
        lifecycle_state: text(state.lifecycle_state).toUpperCase(),
        status: "pending",
        shadow_mode: false,
        scheduled_for: generatedAt,
        reason_codes: [...new Set([...reasons(state.reason_codes), "LIVE_RECONCILIATION"])],
        evidence: {
          ...stateEvidence,
          runtimeReconcile: true,
          runtimeConfigSource: config.source,
          observedShoplingSaleStatus: current,
          desiredShoplingSaleStatus: desiredCode,
          reconciledAt: generatedAt,
          deleteExecutionAllowed: false,
        },
        updated_at: generatedAt,
      });
    }
  }

  let queuedMismatchCount = 0;
  if (config.shoplingNonDestructiveLive && mismatchRows.length) {
    const queued = await admin
      .from(QUEUE_TABLE)
      .upsert(mismatchRows, { onConflict: "dedupe_key", ignoreDuplicates: true });
    if (queued.error) {
      throw new Error(`PRODUCT_LIFECYCLE_RECONCILE_QUEUE_FAILED:${queued.error.message}`);
    }
    queuedMismatchCount = mismatchRows.length;
  }

  const summary: ProductLifecycleLiveReconcileSummary = {
    generatedAt,
    config,
    purchaseGateApplied: config.purchaseStopLive,
    shoplingWriteGateEnabled: config.shoplingNonDestructiveLive,
    productCount: eligibleProducts.length,
    listingCount: allGoodsKeys.length,
    observedReadyCount,
    alreadyAlignedCount,
    wouldQueueMismatchCount: mismatchRows.length,
    queuedMismatchCount,
    unresolvedCount,
    blockedQueueSkippedCount,
    deleteQueuedCount: 0,
  };
  await storeOperation(admin, summary);
  return summary;
}

async function storeOperation(admin: AdminClient, summary: ProductLifecycleLiveReconcileSummary) {
  const result = await admin.from("commerce_operation_runs").upsert(
    {
      operation_type: OPERATION_TYPE,
      status: "SUCCEEDED",
      source: SOURCE,
      source_event_id: `product-lifecycle-live-reconcile:${currentHourKey(summary.generatedAt)}`,
      correlation_id: `product-lifecycle-live-reconcile:${summary.generatedAt.slice(0, 10)}`,
      actor_type: "SYSTEM",
      input_snapshot: {
        generatedAt: summary.generatedAt,
        config: summary.config,
      },
      result_snapshot: summary,
      error_message: null,
      started_at: summary.generatedAt,
      finished_at: summary.generatedAt,
      updated_at: summary.generatedAt,
    },
    { onConflict: "source_event_id", ignoreDuplicates: true },
  );
  if (result.error) {
    throw new Error(`PRODUCT_LIFECYCLE_RECONCILE_OPERATION_STORE_FAILED:${result.error.message}`);
  }
}
