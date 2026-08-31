import type { ProductDecisionSnapshot } from "@/lib/productDecisionSnapshot";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ProductLifecyclePurchaseOverlaySummary = {
  configured: boolean;
  matchedCount: number;
  stopPolicyCount: number;
  simulatedStopCount: number;
  appliedStopCount: number;
  shadowCount: number;
};

type LifecyclePurchaseRow = {
  barcode?: unknown;
  lifecycle_state?: unknown;
  purchase_policy?: unknown;
  shadow_mode?: unknown;
  reason_codes?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().toUpperCase();
}

function reasons(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function nonnegative(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export async function applyProductLifecyclePurchaseOverlay(
  snapshot: ProductDecisionSnapshot,
): Promise<{
  snapshot: ProductDecisionSnapshot;
  summary: ProductLifecyclePurchaseOverlaySummary;
}> {
  const admin = await createSupabaseAdminClient();
  if (!admin) {
    return {
      snapshot,
      summary: {
        configured: false,
        matchedCount: 0,
        stopPolicyCount: 0,
        simulatedStopCount: 0,
        appliedStopCount: 0,
        shadowCount: 0,
      },
    };
  }

  const result = await admin
    .from("product_lifecycle_states")
    .select("barcode,lifecycle_state,purchase_policy,shadow_mode,reason_codes")
    .limit(10_000);
  if (result.error) {
    if (result.error.code === "42P01") {
      return {
        snapshot,
        summary: {
          configured: false,
          matchedCount: 0,
          stopPolicyCount: 0,
          simulatedStopCount: 0,
          appliedStopCount: 0,
          shadowCount: 0,
        },
      };
    }
    throw new Error(`PRODUCT_LIFECYCLE_PURCHASE_OVERLAY_FAILED:${result.error.message}`);
  }

  const rows = (Array.isArray(result.data) ? result.data : []) as LifecyclePurchaseRow[];
  const byBarcode = new Map(
    rows
      .map((row) => [text(row.barcode), row] as const)
      .filter(([barcode]) => Boolean(barcode)),
  );
  let matchedCount = 0;
  let stopPolicyCount = 0;
  let simulatedStopCount = 0;
  let appliedStopCount = 0;
  let shadowCount = 0;

  const products = (snapshot.products ?? []).map((product) => {
    const lifecycle = byBarcode.get(text(product.barcode));
    if (!lifecycle) return product;
    matchedCount += 1;
    const lifecycleState = text(lifecycle.lifecycle_state);
    const purchasePolicy = text(lifecycle.purchase_policy);
    const shadowMode = lifecycle.shadow_mode !== false;
    const reasonCodes = reasons(lifecycle.reason_codes);
    const currentRecommendedQty = nonnegative(product.recommendedQty);
    const currentExpectedCost = nonnegative(product.expectedCost);
    if (shadowMode) shadowCount += 1;
    if (purchasePolicy === "STOP") stopPolicyCount += 1;

    const shouldStop = purchasePolicy === "STOP" && currentRecommendedQty > 0;
    if (shouldStop && shadowMode) simulatedStopCount += 1;
    if (shouldStop && !shadowMode) appliedStopCount += 1;

    return {
      ...product,
      lifecycleState,
      lifecyclePurchasePolicy: purchasePolicy,
      lifecycleShadowMode: shadowMode,
      lifecycleReasonCodes: reasonCodes,
      lifecycleOriginalRecommendedQty: currentRecommendedQty,
      recommendedQty: shouldStop && !shadowMode ? 0 : currentRecommendedQty,
      expectedCost: shouldStop && !shadowMode ? 0 : currentExpectedCost,
    };
  });

  return {
    snapshot: { ...snapshot, products },
    summary: {
      configured: true,
      matchedCount,
      stopPolicyCount,
      simulatedStopCount,
      appliedStopCount,
      shadowCount,
    },
  };
}
