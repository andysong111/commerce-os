import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import {
  evaluateProductLifecycle,
  PRODUCT_LIFECYCLE_RULE_VERSION,
  type ProductLifecyclePolicyDecision,
  type ProductLifecyclePreviousState,
  type ProductLifecycleState,
} from "@/lib/productLifecyclePolicy";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const PRODUCT_LIFECYCLE_REFRESH_OPERATION_TYPE =
  "PRODUCT_LIFECYCLE_SLOT_REFRESH";

const SOURCE = "ops-center-product-lifecycle";
const STATE_TABLE = "product_lifecycle_states";
const EVENT_TABLE = "product_lifecycle_events";
const SHOPLING_QUEUE_TABLE = "shopling_lifecycle_action_queue";
const MAX_PRODUCTS = 10_000;

type LifecyclePlanningFields = {
  productStatus?: string | null;
  lastSaleAt?: string | null;
  salesQuantity30?: number | null;
  salesQuantity90?: number | null;
  salesQuantity365?: number | null;
  salesTrend?: string | null;
  salesTrendRate?: number | null;
  dataStatus?: string | null;
};

type LifecycleDbRow = {
  sku_id?: unknown;
  barcode?: unknown;
  lifecycle_state?: unknown;
  desired_shopling_state?: unknown;
  purchase_policy?: unknown;
  warehouse_policy?: unknown;
  shadow_mode?: unknown;
  evaluated_at?: unknown;
  next_evaluation_at?: unknown;
  reason_codes?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function lifecycleState(value: unknown): ProductLifecycleState | null {
  const candidate = text(value) as ProductLifecycleState;
  return [
    "TEST",
    "EXPAND",
    "MAINTAIN",
    "REDUCE",
    "DORMANT",
    "RETEST",
    "DISCONTINUE",
  ].includes(candidate)
    ? candidate
    : null;
}

function previousState(row: LifecycleDbRow | undefined): ProductLifecyclePreviousState | null {
  if (!row) return null;
  const state = lifecycleState(row.lifecycle_state);
  if (!state) return null;
  const shopling = text(row.desired_shopling_state);
  const purchase = text(row.purchase_policy);
  const warehouse = text(row.warehouse_policy);
  if (!["SELLING", "SOLD_OUT", "DELETE"].includes(shopling)) return null;
  if (!["NORMAL", "STOP"].includes(purchase)) return null;
  if (!["KEEP", "TRIM", "EXIT"].includes(warehouse)) return null;
  return {
    lifecycleState: state,
    desiredShoplingState: shopling as ProductLifecyclePreviousState["desiredShoplingState"],
    purchasePolicy: purchase as ProductLifecyclePreviousState["purchasePolicy"],
    warehousePolicy: warehouse as ProductLifecyclePreviousState["warehousePolicy"],
    evaluatedAt: iso(row.evaluated_at),
    nextEvaluationAt: iso(row.next_evaluation_at),
  };
}

function lifecycleMode() {
  return process.env.PRODUCT_LIFECYCLE_ENFORCEMENT_MODE?.trim().toLowerCase() === "live"
    ? "live"
    : "shadow";
}

function changed(previous: ProductLifecyclePreviousState | null, decision: ProductLifecyclePolicyDecision) {
  return (
    !previous ||
    previous.lifecycleState !== decision.lifecycleState ||
    previous.desiredShoplingState !== decision.desiredShoplingState ||
    previous.purchasePolicy !== decision.purchasePolicy ||
    previous.warehousePolicy !== decision.warehousePolicy
  );
}

function currentHourKey(now: string) {
  return now.slice(0, 13).replace(/[:T]/g, "-");
}

function operationSourceEventId(now: string, fingerprint: string) {
  return `product-lifecycle:${currentHourKey(now)}:${fingerprint.replace(/^sha256:/, "").slice(0, 32)}`;
}

function listingGoodsKeys(product: { listings?: Array<{ goodsKey?: string | null; active?: boolean }> }) {
  return [...new Set(
    (product.listings ?? [])
      .filter((listing) => listing.active !== false)
      .map((listing) => text(listing.goodsKey))
      .filter((value) => /^\d{5,9}$/.test(value)),
  )];
}

export type ProductLifecycleRefreshSummary = {
  generatedAt: string;
  mode: "shadow" | "live";
  ruleVersion: string;
  sourceFingerprint: string;
  productCount: number;
  stateCounts: Record<ProductLifecycleState, number>;
  changedCount: number;
  exceptionCount: number;
  shoplingQueueCount: number;
  purchaseStopCount: number;
  destructiveEligibleCount: number;
  priceGradeUsed: false;
  pricePolicyChanged: false;
};

export async function runProductLifecycleRefresh(
  nowValue: Date | string = new Date(),
): Promise<ProductLifecycleRefreshSummary> {
  const nowDate = nowValue instanceof Date ? new Date(nowValue) : new Date(nowValue);
  if (!Number.isFinite(nowDate.valueOf())) throw new Error("PRODUCT_LIFECYCLE_NOW_INVALID");
  const generatedAt = nowDate.toISOString();
  const mode = lifecycleMode();
  const shadowMode = mode !== "live";
  const planning = await loadProductPlanningSnapshot();
  if (planning.products.length > MAX_PRODUCTS) {
    throw new Error(`PRODUCT_LIFECYCLE_PRODUCT_LIMIT_EXCEEDED:${planning.products.length}`);
  }

  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");

  const existingResult = await admin
    .from(STATE_TABLE)
    .select(
      "sku_id,barcode,lifecycle_state,desired_shopling_state,purchase_policy,warehouse_policy,shadow_mode,evaluated_at,next_evaluation_at,reason_codes",
    )
    .limit(MAX_PRODUCTS);
  if (existingResult.error) throw new Error(existingResult.error.message);
  const existingRows = (Array.isArray(existingResult.data) ? existingResult.data : []) as LifecycleDbRow[];
  const existingBySku = new Map(existingRows.map((row) => [text(row.sku_id), row] as const));

  const states: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  const queueRows: Array<Record<string, unknown>> = [];
  const stateCounts: Record<ProductLifecycleState, number> = {
    TEST: 0,
    EXPAND: 0,
    MAINTAIN: 0,
    REDUCE: 0,
    DORMANT: 0,
    RETEST: 0,
    DISCONTINUE: 0,
  };
  let exceptionCount = 0;
  let purchaseStopCount = 0;
  let destructiveEligibleCount = 0;

  for (const rawProduct of planning.products) {
    const product = rawProduct as typeof rawProduct & LifecyclePlanningFields;
    const skuId = text(product.skuId);
    const barcode = text(product.barcode).toUpperCase();
    if (!skuId || !barcode) continue;
    const previousRow = existingBySku.get(skuId);
    const previous = previousState(previousRow);
    const decision = evaluateProductLifecycle(
      {
        skuId,
        barcode,
        productStatus: product.productStatus,
        skuActive: product.skuActive,
        lastSaleAt: product.lastSaleAt,
        salesQuantity30: product.salesQuantity30,
        salesQuantity90: product.salesQuantity90,
        salesQuantity365: product.salesQuantity365,
        salesTrend: product.salesTrend,
        salesTrendRate: product.salesTrendRate,
        inventoryQuantity: product.inventoryQuantity,
        inventoryConfirmed: product.inventoryConfirmed,
        inventoryRequiresReview: product.inventoryRequiresReview,
        dataStatus: product.dataStatus,
        previous,
      },
      nowDate,
    );

    stateCounts[decision.lifecycleState] += 1;
    if (decision.requiresReview) exceptionCount += 1;
    if (decision.purchasePolicy === "STOP") purchaseStopCount += 1;
    if (decision.destructiveActionEligible) destructiveEligibleCount += 1;

    const evidence = {
      productName: text(product.productName),
      modelNo: text(product.modelNo),
      productStatus: text(product.productStatus),
      lastSaleAt: iso(product.lastSaleAt),
      noSaleDays: decision.noSaleDays,
      salesQuantity30: number(product.salesQuantity30),
      salesQuantity90: number(product.salesQuantity90),
      salesQuantity365: number(product.salesQuantity365),
      salesTrend: text(product.salesTrend),
      salesTrendRate: product.salesTrendRate ?? null,
      inventoryQuantity: number(product.inventoryQuantity),
      inventoryConfirmed: Boolean(product.inventoryConfirmed),
      inventoryRequiresReview: Boolean(product.inventoryRequiresReview),
      activeListingCount: listingGoodsKeys(product).length,
    };

    states.push({
      sku_id: skuId,
      barcode,
      lifecycle_state: decision.lifecycleState,
      desired_shopling_state: decision.desiredShoplingState,
      purchase_policy: decision.purchasePolicy,
      warehouse_policy: decision.warehousePolicy,
      shadow_mode: shadowMode,
      requires_review: decision.requiresReview,
      review_reason: decision.reviewReason,
      last_sale_at: iso(product.lastSaleAt),
      no_sale_days: decision.noSaleDays,
      sales_quantity_30: number(product.salesQuantity30),
      sales_quantity_90: number(product.salesQuantity90),
      sales_quantity_365: number(product.salesQuantity365),
      sales_trend: text(product.salesTrend) || "INSUFFICIENT",
      momentum_ratio: decision.momentumRatio,
      inventory_quantity: number(product.inventoryQuantity),
      inventory_confirmed: Boolean(product.inventoryConfirmed),
      next_evaluation_at: decision.nextEvaluationAt,
      reason_codes: decision.reasonCodes,
      evidence,
      source_fingerprint: planning.contentFingerprint,
      rule_version: PRODUCT_LIFECYCLE_RULE_VERSION,
      evaluated_at: generatedAt,
      updated_at: generatedAt,
    });

    if (!changed(previous, decision)) continue;

    events.push({
      sku_id: skuId,
      barcode,
      previous_state: previous?.lifecycleState ?? null,
      new_state: decision.lifecycleState,
      previous_shopling_state: previous?.desiredShoplingState ?? null,
      new_shopling_state: decision.desiredShoplingState,
      previous_purchase_policy: previous?.purchasePolicy ?? null,
      new_purchase_policy: decision.purchasePolicy,
      previous_warehouse_policy: previous?.warehousePolicy ?? null,
      new_warehouse_policy: decision.warehousePolicy,
      shadow_mode: shadowMode,
      requires_review: decision.requiresReview,
      reason_codes: decision.reasonCodes,
      evidence,
      source_fingerprint: planning.contentFingerprint,
      rule_version: PRODUCT_LIFECYCLE_RULE_VERSION,
      evaluated_at: generatedAt,
    });

    const previousDesired = previous?.desiredShoplingState ?? "SELLING";
    if (previousDesired === decision.desiredShoplingState) continue;
    for (const goodsKey of listingGoodsKeys(product)) {
      queueRows.push({
        dedupe_key: [
          skuId,
          goodsKey,
          decision.lifecycleState,
          decision.desiredShoplingState,
          planning.contentFingerprint,
        ].join(":"),
        sku_id: skuId,
        barcode,
        goods_key: goodsKey,
        desired_state: decision.desiredShoplingState,
        lifecycle_state: decision.lifecycleState,
        status: shadowMode ? "shadow" : "pending",
        shadow_mode: shadowMode,
        scheduled_for: generatedAt,
        reason_codes: decision.reasonCodes,
        evidence,
        updated_at: generatedAt,
      });
    }
  }

  const upsert = await admin
    .from(STATE_TABLE)
    .upsert(states, { onConflict: "sku_id" });
  if (upsert.error) throw new Error(`PRODUCT_LIFECYCLE_STATE_UPSERT_FAILED:${upsert.error.message}`);

  if (events.length) {
    const insertedEvents = await admin.from(EVENT_TABLE).insert(events);
    if (insertedEvents.error) {
      throw new Error(`PRODUCT_LIFECYCLE_EVENT_INSERT_FAILED:${insertedEvents.error.message}`);
    }
  }

  if (queueRows.length) {
    const queued = await admin
      .from(SHOPLING_QUEUE_TABLE)
      .upsert(queueRows, { onConflict: "dedupe_key", ignoreDuplicates: true });
    if (queued.error) {
      throw new Error(`PRODUCT_LIFECYCLE_QUEUE_UPSERT_FAILED:${queued.error.message}`);
    }
  }

  const summary: ProductLifecycleRefreshSummary = {
    generatedAt,
    mode,
    ruleVersion: PRODUCT_LIFECYCLE_RULE_VERSION,
    sourceFingerprint: planning.contentFingerprint,
    productCount: states.length,
    stateCounts,
    changedCount: events.length,
    exceptionCount,
    shoplingQueueCount: queueRows.length,
    purchaseStopCount,
    destructiveEligibleCount,
    priceGradeUsed: false,
    pricePolicyChanged: false,
  };

  const operation = await admin.from("commerce_operation_runs").upsert(
    {
      operation_type: PRODUCT_LIFECYCLE_REFRESH_OPERATION_TYPE,
      status: "SUCCEEDED",
      source: SOURCE,
      source_event_id: operationSourceEventId(generatedAt, planning.contentFingerprint),
      correlation_id: `product-lifecycle:${generatedAt.slice(0, 10)}`,
      actor_type: "SYSTEM",
      input_snapshot: {
        generatedAt,
        mode,
        ruleVersion: PRODUCT_LIFECYCLE_RULE_VERSION,
        sourceFingerprint: planning.contentFingerprint,
      },
      result_snapshot: summary,
      error_message: null,
      started_at: generatedAt,
      finished_at: generatedAt,
      updated_at: generatedAt,
    },
    { onConflict: "source_event_id", ignoreDuplicates: true },
  );
  if (operation.error) {
    throw new Error(`PRODUCT_LIFECYCLE_OPERATION_STORE_FAILED:${operation.error.message}`);
  }

  return summary;
}

export async function loadProductLifecycleDashboard() {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const [statesResult, queueResult] = await Promise.all([
    admin
      .from(STATE_TABLE)
      .select(
        "sku_id,barcode,lifecycle_state,desired_shopling_state,purchase_policy,warehouse_policy,shadow_mode,requires_review,review_reason,last_sale_at,no_sale_days,sales_quantity_30,sales_quantity_90,sales_quantity_365,sales_trend,inventory_quantity,inventory_confirmed,next_evaluation_at,reason_codes,evidence,evaluated_at",
      )
      .order("requires_review", { ascending: false })
      .order("no_sale_days", { ascending: false })
      .limit(1000),
    admin
      .from(SHOPLING_QUEUE_TABLE)
      .select(
        "id,sku_id,barcode,goods_key,desired_state,lifecycle_state,status,shadow_mode,scheduled_for,reason_codes,last_error,updated_at",
      )
      .in("status", ["shadow", "pending", "claimed", "failed", "confirm_needed"])
      .order("updated_at", { ascending: false })
      .limit(500),
  ]);
  if (statesResult.error) throw new Error(statesResult.error.message);
  if (queueResult.error) throw new Error(queueResult.error.message);
  return {
    states: Array.isArray(statesResult.data) ? statesResult.data : [],
    queue: Array.isArray(queueResult.data) ? queueResult.data : [],
  };
}
