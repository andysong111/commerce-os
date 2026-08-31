const DAY_MS = 86_400_000;

export const PRODUCT_LIFECYCLE_RULE_VERSION = "commerce-os-product-lifecycle-v1.0.1";
export const DORMANT_AFTER_DAYS = 180;
export const DISCONTINUE_AFTER_DAYS = 365;
export const DORMANT_RETEST_AFTER_DAYS = 90;
export const RETEST_WINDOW_DAYS = 30;

export type ProductLifecycleState =
  | "TEST"
  | "EXPAND"
  | "MAINTAIN"
  | "REDUCE"
  | "DORMANT"
  | "RETEST"
  | "DISCONTINUE";

export type ProductLifecycleShoplingState = "SELLING" | "SOLD_OUT" | "DELETE";
export type ProductLifecyclePurchasePolicy = "NORMAL" | "STOP";
export type ProductLifecycleWarehousePolicy = "KEEP" | "TRIM" | "EXIT";

export type ProductLifecyclePreviousState = {
  lifecycleState: ProductLifecycleState;
  desiredShoplingState: ProductLifecycleShoplingState;
  purchasePolicy: ProductLifecyclePurchasePolicy;
  warehousePolicy: ProductLifecycleWarehousePolicy;
  evaluatedAt?: string | null;
  nextEvaluationAt?: string | null;
};

export type ProductLifecyclePolicyInput = {
  skuId: string;
  barcode: string;
  productStatus?: string | null;
  skuActive?: boolean;
  lastSaleAt?: string | null;
  salesQuantity30?: number | null;
  salesQuantity90?: number | null;
  salesQuantity365?: number | null;
  salesTrend?: string | null;
  salesTrendRate?: number | null;
  inventoryQuantity?: number | null;
  inventoryConfirmed?: boolean;
  inventoryRequiresReview?: boolean;
  dataStatus?: string | null;
  previous?: ProductLifecyclePreviousState | null;
};

export type ProductLifecyclePolicyDecision = {
  lifecycleState: ProductLifecycleState;
  desiredShoplingState: ProductLifecycleShoplingState;
  purchasePolicy: ProductLifecyclePurchasePolicy;
  warehousePolicy: ProductLifecycleWarehousePolicy;
  requiresReview: boolean;
  reviewReason: string | null;
  noSaleDays: number | null;
  momentumRatio: number | null;
  nextEvaluationAt: string | null;
  reasonCodes: string[];
  destructiveActionEligible: boolean;
};

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function iso(value: unknown) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function addDays(value: Date, days: number) {
  return new Date(value.valueOf() + days * DAY_MS).toISOString();
}

function daysSince(value: unknown, now: Date) {
  const parsed = Date.parse(String(value ?? ""));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((now.valueOf() - parsed) / DAY_MS));
}

function due(value: unknown, now: Date) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) && parsed <= now.valueOf();
}

function momentumRatio(quantity30: number, quantity90: number) {
  const previous60Average = Math.max(0, quantity90 - quantity30) / 2;
  if (previous60Average <= 0) return quantity30 > 0 ? null : 0;
  return Math.round((quantity30 / previous60Average) * 1000) / 1000;
}

function shoplingStateFor(input: {
  lifecycleState: ProductLifecycleState;
  inventoryQuantity: number;
  inventoryConfirmed: boolean;
  inventoryRequiresReview: boolean;
}) {
  const inventorySafe = input.inventoryConfirmed && !input.inventoryRequiresReview;
  if (input.lifecycleState === "DISCONTINUE") {
    return inventorySafe && input.inventoryQuantity <= 0 ? "DELETE" : "SELLING";
  }
  if (input.lifecycleState === "DORMANT") {
    return inventorySafe && input.inventoryQuantity <= 0 ? "SOLD_OUT" : "SELLING";
  }
  return "SELLING";
}

function finalDecision(input: {
  lifecycleState: ProductLifecycleState;
  inventoryQuantity: number;
  inventoryConfirmed: boolean;
  inventoryRequiresReview: boolean;
  noSaleDays: number | null;
  momentumRatio: number | null;
  nextEvaluationAt?: string | null;
  reasonCodes: string[];
}): ProductLifecyclePolicyDecision {
  const desiredShoplingState = shoplingStateFor(input);
  const destructiveActionEligible = desiredShoplingState === "DELETE";
  const destructiveInventoryUnverified =
    input.lifecycleState === "DISCONTINUE" && !input.inventoryConfirmed;
  const requiresReview = input.inventoryRequiresReview || destructiveInventoryUnverified;
  const reviewReason = input.inventoryRequiresReview
    ? "INVENTORY_DATA_REVIEW_REQUIRED"
    : destructiveInventoryUnverified
      ? "INVENTORY_NOT_SAFE_FOR_DESTRUCTIVE_ACTION"
      : null;

  return {
    lifecycleState: input.lifecycleState,
    desiredShoplingState,
    purchasePolicy:
      input.lifecycleState === "DORMANT" || input.lifecycleState === "DISCONTINUE"
        ? "STOP"
        : "NORMAL",
    warehousePolicy:
      input.lifecycleState === "DISCONTINUE"
        ? "EXIT"
        : input.lifecycleState === "REDUCE" || input.lifecycleState === "DORMANT"
          ? "TRIM"
          : "KEEP",
    requiresReview,
    reviewReason,
    noSaleDays: input.noSaleDays,
    momentumRatio: input.momentumRatio,
    nextEvaluationAt: input.nextEvaluationAt ?? null,
    reasonCodes: requiresReview && reviewReason
      ? [...new Set([...input.reasonCodes, reviewReason])]
      : [...new Set(input.reasonCodes)],
    destructiveActionEligible: destructiveActionEligible && !requiresReview,
  };
}

export function evaluateProductLifecycle(
  input: ProductLifecyclePolicyInput,
  nowValue: Date | string = new Date(),
): ProductLifecyclePolicyDecision {
  const now = nowValue instanceof Date ? new Date(nowValue) : new Date(nowValue);
  if (!Number.isFinite(now.valueOf())) throw new Error("PRODUCT_LIFECYCLE_NOW_INVALID");

  const quantity30 = number(input.salesQuantity30);
  const quantity90 = number(input.salesQuantity90);
  const quantity365 = number(input.salesQuantity365);
  const inventoryQuantity = number(input.inventoryQuantity);
  const inventoryConfirmed = Boolean(input.inventoryConfirmed);
  const inventoryRequiresReview = Boolean(input.inventoryRequiresReview);
  const noSaleDays = daysSince(input.lastSaleAt, now);
  const momentum = momentumRatio(quantity30, quantity90);
  const productStatus = String(input.productStatus ?? "").toUpperCase();
  const salesTrend = String(input.salesTrend ?? "").toUpperCase();
  const previous = input.previous ?? null;

  const decide = (
    lifecycleState: ProductLifecycleState,
    reasonCodes: string[],
    nextEvaluationAt: string | null = null,
  ) => finalDecision({
    lifecycleState,
    inventoryQuantity,
    inventoryConfirmed,
    inventoryRequiresReview,
    noSaleDays,
    momentumRatio: momentum,
    nextEvaluationAt,
    reasonCodes,
  });

  if (productStatus === "DISCONTINUED" || input.skuActive === false) {
    return decide("DISCONTINUE", ["SOURCE_PRODUCT_DISCONTINUED"]);
  }

  if (noSaleDays !== null && noSaleDays >= DISCONTINUE_AFTER_DAYS) {
    return decide("DISCONTINUE", ["NO_SALE_365_DAYS"]);
  }

  if (
    previous?.lifecycleState === "RETEST" &&
    previous.nextEvaluationAt &&
    !due(previous.nextEvaluationAt, now) &&
    quantity30 <= 0
  ) {
    return decide("RETEST", ["RETEST_WINDOW_ACTIVE"], iso(previous.nextEvaluationAt));
  }

  if (
    previous?.lifecycleState === "DORMANT" &&
    previous.nextEvaluationAt &&
    due(previous.nextEvaluationAt, now) &&
    (noSaleDays === null || noSaleDays < DISCONTINUE_AFTER_DAYS)
  ) {
    return decide(
      "RETEST",
      ["DORMANT_RETEST_DUE"],
      addDays(now, RETEST_WINDOW_DAYS),
    );
  }

  if (
    previous?.lifecycleState === "RETEST" &&
    previous.nextEvaluationAt &&
    due(previous.nextEvaluationAt, now) &&
    quantity30 <= 0
  ) {
    return decide(
      "DORMANT",
      ["RETEST_NO_SALE"],
      addDays(now, DORMANT_RETEST_AFTER_DAYS),
    );
  }

  if (noSaleDays !== null && noSaleDays >= DORMANT_AFTER_DAYS) {
    return decide(
      "DORMANT",
      ["NO_SALE_180_DAYS"],
      addDays(now, DORMANT_RETEST_AFTER_DAYS),
    );
  }

  if (quantity365 <= 0 && !input.lastSaleAt) {
    return decide("TEST", [productStatus === "LAUNCHING" ? "NEW_LAUNCH_TEST" : "NO_SALE_HISTORY_TEST"]);
  }

  if (quantity30 <= 0 && quantity90 > 0) {
    return decide("REDUCE", ["RECENT_30D_ZERO_SALES"]);
  }

  if (quantity30 <= 0 && quantity365 > 0) {
    return decide("REDUCE", ["RECENT_SALES_WEAK"]);
  }

  const rising =
    salesTrend === "RISING" ||
    (momentum !== null && momentum >= 1.35 && quantity30 >= 3);
  if (quantity30 > 0 && rising) {
    return decide("EXPAND", ["RECENT_SALES_ACCELERATING"]);
  }

  const falling =
    salesTrend === "FALLING" &&
    momentum !== null &&
    momentum <= 0.65;
  if (quantity30 > 0 && falling) {
    return decide("REDUCE", ["RECENT_SALES_DECELERATING"]);
  }

  return decide("MAINTAIN", ["NORMAL_ACTIVE_CYCLE"]);
}
