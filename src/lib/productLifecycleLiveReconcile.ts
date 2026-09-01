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
const AUDIT_SAMPLE_LIMIT = 50;

type LifecycleStateRow = {
  sku_id?: unknown;
  barcode?: unknown;
  lifecycle_state?: unknown;
  desired_shopling_state?: unknown;
  requires_review?: unknown;
  reason_codes?: unknown;
  evidence?: unknown;
};

type LifecycleListingReference = {
  skuId: string;
  barcode: string;
  lifecycleState: string;
  desiredState: string;
  desiredCode: string;
  requiresReview: boolean;
  reasonCodes: string[];
  evidence: Record<string, unknown>;
};

type MismatchAuditSample = {
  goodsKey: string;
  currentSaleStatus: string;
  desiredState: string;
  desiredSaleStatus: string;
  referenceCount: number;
  referenceSkuIds: string[];
  lifecycleStates: string[];
};

type UnresolvedAuditSample = {
  goodsKey: string;
  reason: string;
  currentSaleStatus?: string;
  desiredStates: string[];
  referenceCount: number;
  referenceSkuIds: string[];
};

type AdminClient = NonNullable<Awaited<ReturnType<typeof createSupabaseAdminClient>>>;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function reasons(value: unknown) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
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

function configAuditKey(config: ProductLifecycleRuntimeConfig) {
  return [
    config.shoplingNonDestructiveLive ? "shopling1" : "shopling0",
    config.purchaseStopLive ? "purchase1" : "purchase0",
    config.deleteLive ? "delete1" : "delete0",
    `limit${config.shoplingLiveBatchLimit}`,
  ].join(":");
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function sortedReferences(references: LifecycleListingReference[]) {
  return [...references].sort((left, right) => left.skuId.localeCompare(right.skuId));
}

function referenceSkuIds(references: LifecycleListingReference[]) {
  return unique(references.map((reference) => reference.skuId)).slice(0, 20);
}

function unresolvedSample(
  goodsKey: string,
  reason: string,
  references: LifecycleListingReference[],
  currentSaleStatus?: string,
): UnresolvedAuditSample {
  return {
    goodsKey,
    reason,
    ...(currentSaleStatus ? { currentSaleStatus } : {}),
    desiredStates: unique(references.map((reference) => reference.desiredState)),
    referenceCount: references.length,
    referenceSkuIds: referenceSkuIds(references),
  };
}

export type ProductLifecycleLiveReconcileSummary = {
  generatedAt: string;
  config: ProductLifecycleRuntimeConfig;
  purchaseGateApplied: boolean;
  shoplingWriteGateEnabled: boolean;
  productCount: number;
  listingReferenceCount: number;
  listingCount: number;
  duplicateReferenceGoodsKeyCount: number;
  targetConflictCount: number;
  observedReadyCount: number;
  alreadyAlignedCount: number;
  wouldQueueMismatchCount: number;
  queuedMismatchCount: number;
  deferredMismatchCount: number;
  unresolvedCount: number;
  blockedQueueSkippedCount: number;
  mismatchSample: MismatchAuditSample[];
  unresolvedSample: UnresolvedAuditSample[];
  deleteQueuedCount: 0;
};

export async function runProductLifecycleLiveReconcile(
  nowValue: Date | string = new Date(),
): Promise<ProductLifecycleLiveReconcileSummary> {
  const nowDate = nowValue instanceof Date ? new Date(nowValue) : new Date(nowValue);
  if (!Number.isFinite(nowDate.valueOf())) {
    throw new Error("PRODUCT_LIFECYCLE_RECONCILE_NOW_INVALID");
  }
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
  if (statesResult.error) {
    throw new Error(`PRODUCT_LIFECYCLE_RECONCILE_STATE_READ_FAILED:${statesResult.error.message}`);
  }
  if (blockingQueueResult.error) {
    throw new Error(`PRODUCT_LIFECYCLE_RECONCILE_QUEUE_READ_FAILED:${blockingQueueResult.error.message}`);
  }

  const stateRows = (Array.isArray(statesResult.data) ? statesResult.data : []) as LifecycleStateRow[];
  const statesBySku = new Map(stateRows.map((row) => [text(row.sku_id), row] as const));
  const blockingGoodsKeys = new Set(
    (Array.isArray(blockingQueueResult.data) ? blockingQueueResult.data : [])
      .map((row) => text(row.goods_key))
      .filter((value) => /^\d{5,9}$/.test(value)),
  );

  const productsWithState = planning.products
    .map((product) => ({ product, state: statesBySku.get(text(product.skuId)) }))
    .filter(({ state }) => Boolean(state));

  const referencesByGoodsKey = new Map<string, LifecycleListingReference[]>();
  let listingReferenceCount = 0;
  for (const { product, state } of productsWithState) {
    if (!state) continue;
    const reference: LifecycleListingReference = {
      skuId: text(state.sku_id),
      barcode: text(state.barcode).toUpperCase(),
      lifecycleState: text(state.lifecycle_state).toUpperCase(),
      desiredState: text(state.desired_shopling_state).toUpperCase(),
      desiredCode: desiredSaleStatus(state.desired_shopling_state),
      requiresReview: state.requires_review === true,
      reasonCodes: reasons(state.reason_codes),
      evidence: object(state.evidence),
    };
    for (const goodsKey of listingGoodsKeys(product)) {
      const existing = referencesByGoodsKey.get(goodsKey) ?? [];
      existing.push(reference);
      referencesByGoodsKey.set(goodsKey, existing);
      listingReferenceCount += 1;
    }
  }

  const allGoodsKeys = [...referencesByGoodsKey.keys()];
  const snapshot = await loadShoplingLifecycleStatusSnapshot(allGoodsKeys);
  const observedByGoodsKey = new Map(snapshot.statuses.map((row) => [row.goodsKey, row] as const));
  const mismatchRows: Array<Record<string, unknown>> = [];
  const mismatchSample: MismatchAuditSample[] = [];
  const unresolvedSamples: UnresolvedAuditSample[] = [];

  let duplicateReferenceGoodsKeyCount = 0;
  let targetConflictCount = 0;
  let observedReadyCount = 0;
  let alreadyAlignedCount = 0;
  let unresolvedCount = 0;
  let blockedQueueSkippedCount = 0;

  for (const goodsKey of allGoodsKeys) {
    const references = sortedReferences(referencesByGoodsKey.get(goodsKey) ?? []);
    if (!references.length) continue;
    if (references.length > 1) duplicateReferenceGoodsKeyCount += 1;

    if (blockingGoodsKeys.has(goodsKey)) {
      blockedQueueSkippedCount += 1;
      continue;
    }

    if (references.some((reference) => reference.requiresReview)) {
      unresolvedCount += 1;
      if (unresolvedSamples.length < AUDIT_SAMPLE_LIMIT) {
        unresolvedSamples.push(unresolvedSample(goodsKey, "REFERENCE_REQUIRES_REVIEW", references));
      }
      continue;
    }

    const desiredStates = unique(references.map((reference) => reference.desiredState));
    const reversibleDesiredStates = desiredStates.filter((state) => state === "SELLING" || state === "SOLD_OUT");
    if (desiredStates.length !== 1 || reversibleDesiredStates.length !== 1) {
      targetConflictCount += 1;
      unresolvedCount += 1;
      if (unresolvedSamples.length < AUDIT_SAMPLE_LIMIT) {
        unresolvedSamples.push(unresolvedSample(goodsKey, "TARGET_CONFLICT_OR_NON_REVERSIBLE", references));
      }
      continue;
    }

    const desiredState = reversibleDesiredStates[0];
    const desiredCode = desiredSaleStatus(desiredState);
    const observed = observedByGoodsKey.get(goodsKey);
    if (!observed || observed.state !== "READY") {
      unresolvedCount += 1;
      if (unresolvedSamples.length < AUDIT_SAMPLE_LIMIT) {
        unresolvedSamples.push(unresolvedSample(goodsKey, `SHOPLING_${text(observed?.state) || "MISSING"}`, references));
      }
      continue;
    }

    observedReadyCount += 1;
    const current = text(observed.currentSaleStatus).toUpperCase();
    if (current === desiredCode) {
      alreadyAlignedCount += 1;
      continue;
    }
    if (!["B", "C"].includes(current)) {
      unresolvedCount += 1;
      if (unresolvedSamples.length < AUDIT_SAMPLE_LIMIT) {
        unresolvedSamples.push(unresolvedSample(goodsKey, "CURRENT_STATE_NOT_REVERSIBLE", references, current));
      }
      continue;
    }

    const canonical = references[0];
    const allReasonCodes = unique(references.flatMap((reference) => reference.reasonCodes));
    const referenceIds = referenceSkuIds(references);
    const lifecycleStates = unique(references.map((reference) => reference.lifecycleState));
    mismatchRows.push({
      dedupe_key: ["live-reconcile", goodsKey, current, desiredState, currentHourKey(generatedAt)].join(":"),
      sku_id: canonical.skuId,
      barcode: canonical.barcode,
      goods_key: goodsKey,
      desired_state: desiredState,
      lifecycle_state: canonical.lifecycleState,
      status: "pending",
      shadow_mode: false,
      scheduled_for: generatedAt,
      reason_codes: [...new Set([...allReasonCodes, "LIVE_RECONCILIATION"])],
      evidence: {
        ...canonical.evidence,
        runtimeReconcile: true,
        runtimeConfigSource: config.source,
        observedShoplingSaleStatus: current,
        desiredShoplingSaleStatus: desiredCode,
        reconciledAt: generatedAt,
        referenceCount: references.length,
        referenceSkuIds: referenceIds,
        lifecycleStates,
        deleteExecutionAllowed: false,
      },
      updated_at: generatedAt,
    });
    if (mismatchSample.length < AUDIT_SAMPLE_LIMIT) {
      mismatchSample.push({
        goodsKey,
        currentSaleStatus: current,
        desiredState,
        desiredSaleStatus: desiredCode,
        referenceCount: references.length,
        referenceSkuIds: referenceIds,
        lifecycleStates,
      });
    }
  }

  const liveRows = mismatchRows.slice(0, config.shoplingLiveBatchLimit);
  let queuedMismatchCount = 0;
  if (config.shoplingNonDestructiveLive && liveRows.length) {
    const queued = await admin
      .from(QUEUE_TABLE)
      .upsert(liveRows, { onConflict: "dedupe_key", ignoreDuplicates: true });
    if (queued.error) {
      throw new Error(`PRODUCT_LIFECYCLE_RECONCILE_QUEUE_FAILED:${queued.error.message}`);
    }
    queuedMismatchCount = liveRows.length;
  }

  const summary: ProductLifecycleLiveReconcileSummary = {
    generatedAt,
    config,
    purchaseGateApplied: config.purchaseStopLive,
    shoplingWriteGateEnabled: config.shoplingNonDestructiveLive,
    productCount: productsWithState.length,
    listingReferenceCount,
    listingCount: allGoodsKeys.length,
    duplicateReferenceGoodsKeyCount,
    targetConflictCount,
    observedReadyCount,
    alreadyAlignedCount,
    wouldQueueMismatchCount: mismatchRows.length,
    queuedMismatchCount,
    deferredMismatchCount: config.shoplingNonDestructiveLive
      ? Math.max(0, mismatchRows.length - liveRows.length)
      : mismatchRows.length,
    unresolvedCount,
    blockedQueueSkippedCount,
    mismatchSample,
    unresolvedSample: unresolvedSamples,
    deleteQueuedCount: 0,
  };
  await storeOperation(admin, summary);
  return summary;
}

async function storeOperation(admin: AdminClient, summary: ProductLifecycleLiveReconcileSummary) {
  const result = await admin.from("commerce_operation_runs").upsert({
    operation_type: OPERATION_TYPE,
    status: "SUCCEEDED",
    source: SOURCE,
    source_event_id: `product-lifecycle-live-reconcile:${currentHourKey(summary.generatedAt)}:${configAuditKey(summary.config)}`,
    correlation_id: `product-lifecycle-live-reconcile:${summary.generatedAt.slice(0, 10)}`,
    actor_type: "SYSTEM",
    input_snapshot: { generatedAt: summary.generatedAt, config: summary.config },
    result_snapshot: summary,
    error_message: null,
    started_at: summary.generatedAt,
    finished_at: summary.generatedAt,
    updated_at: summary.generatedAt,
  }, { onConflict: "source_event_id", ignoreDuplicates: true });
  if (result.error) {
    throw new Error(`PRODUCT_LIFECYCLE_RECONCILE_OPERATION_STORE_FAILED:${result.error.message}`);
  }
}
