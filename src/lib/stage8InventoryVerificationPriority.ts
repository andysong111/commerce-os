import { loadCanonicalPurchaseShadow } from "@/lib/stage8CanonicalPurchaseShadow";
import {
  loadProductMasterInventoryCostReadiness,
  type ProductMasterInventoryCostRow,
} from "@/lib/productMasterInventoryCostReadiness";
import { calculateNetRequirement } from "@/lib/productDecisionEngine/netRequirement";
import type { SalesOrderGroup } from "@/lib/productDecisionEngine/salesOrder";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";

export type InventoryOperatingMode =
  | "VERIFIED"
  | "PROVISIONAL"
  | "REVIEW"
  | "MISSING";

export type InventoryVerificationPriorityRow = {
  barcode: string;
  name: string;
  modelNo: string | null;
  purchaseStatus: SalesOrderGroup;
  originalPurchaseStatus: string;
  recommendedQty: number;
  originalRecommendedQty: number;
  expectedCost: number;
  priorityScore: number;
  inventoryQuantity: number;
  inventoryMode: InventoryOperatingMode;
  inventoryVerified: boolean;
  inventoryVerification: string;
  inventoryRequiresReview: boolean;
  initialZeroUnverified: boolean;
  inventoryBaselineKind: string | null;
  movementCount: number;
  inboundMovementCount: number;
  openCommitment: number;
  hasConfirmedReceiptCost: boolean;
  latestConfirmedReceiptAt: string | null;
  latestConfirmedReceiptCostKrw: number;
  protectedCostKrw: number;
  action:
    | "NONE"
    | "LEDGER_REVIEW_REQUIRED"
    | "COST_CONFIRMATION_REQUIRED";
  operationallyReady: boolean;
};

export type InventoryVerificationPriority = {
  generatedAt: string;
  state: "READY" | "BLOCKED";
  message: string;
  purchaseShadowReady: boolean;
  managedActiveSkuCount: number;
  purchaseRecommendationCount: number;
  operationallyReadyPurchaseCount: number;
  blockedPurchaseRecommendationCount: number;
  provisionalPurchaseCount: number;
  verifiedPurchaseCount: number;
  reviewInventoryCount: number;
  totalExpectedSpend: number;
  operationallyReadyExpectedSpend: number;
  blockedExpectedSpend: number;
  stocktakeRequiredCount: 0;
  writesEnabled: false;
  rows: InventoryVerificationPriorityRow[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value: unknown) {
  return Math.max(0, Math.round(number(value)));
}

function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function inventoryByBarcode(rows: ProductMasterInventoryCostRow[]) {
  return new Map(rows.map((row) => [barcode(row.barcode), row]));
}

function planningByBarcode(
  products: Awaited<ReturnType<typeof loadProductPlanningSnapshot>>["products"],
) {
  return new Map(
    products
      .filter((row) => row.skuActive !== false)
      .map((row) => [barcode(row.barcode), row] as const),
  );
}

function inventoryMode(
  row: ProductMasterInventoryCostRow | undefined,
): InventoryOperatingMode {
  if (!row) return "MISSING";
  if (row.inventoryRequiresReview || row.inventoryVerification === "REVIEW") {
    return "REVIEW";
  }
  if (row.inventoryVerified) return "VERIFIED";
  return "PROVISIONAL";
}

function actionFor(row: ProductMasterInventoryCostRow | undefined) {
  const mode = inventoryMode(row);
  if (mode === "MISSING" || mode === "REVIEW") {
    return "LEDGER_REVIEW_REQUIRED" as const;
  }
  if (!row?.hasConfirmedReceiptCost) {
    return "COST_CONFIRMATION_REQUIRED" as const;
  }
  return "NONE" as const;
}

function salesOrderGroup(value: unknown): SalesOrderGroup {
  const normalized = text(value);
  if (
    normalized === "발주 추천" ||
    normalized === "소량 검토" ||
    normalized === "발주 보류" ||
    normalized === "데이터 부족"
  ) {
    return normalized;
  }
  return "발주 보류";
}

function expectedCostForQuantity(
  previousCost: unknown,
  previousQuantity: unknown,
  nextQuantity: number,
) {
  const quantity = integer(previousQuantity);
  const cost = integer(previousCost);
  if (!quantity || !cost || !nextQuantity) return 0;
  return Math.round((cost / quantity) * nextQuantity);
}

export async function loadInventoryVerificationPriority(): Promise<InventoryVerificationPriority> {
  const [purchaseShadow, inventoryReadiness, planning] = await Promise.all([
    loadCanonicalPurchaseShadow(),
    loadProductMasterInventoryCostReadiness(),
    loadProductPlanningSnapshot(),
  ]);
  const purchaseProducts = purchaseShadow.snapshot?.products ?? [];
  const inventoryIndex = inventoryByBarcode(inventoryReadiness.rows);
  const planningIndex = planningByBarcode(planning.products);

  const rows: InventoryVerificationPriorityRow[] = purchaseProducts
    .map((product) => {
      const key = barcode(product.barcode);
      const inventory = inventoryIndex.get(key);
      const profile = planningIndex.get(key);
      const mode = inventoryMode(inventory);
      const inventoryUsable = mode === "VERIFIED" || mode === "PROVISIONAL";
      const originalGroup = salesOrderGroup(product.status);
      const originalRecommendedQty = integer(product.recommendedQty);
      const demandTarget = integer(
        product.rawRecommendedQty ?? product.recommendedQty,
      );
      const openCommitment = integer(product.openCommitment);
      const net = calculateNetRequirement({
        demandTarget,
        originalGroup,
        inventoryKnown: inventoryUsable,
        availableQuantity: inventoryUsable
          ? integer(inventory?.inventoryQuantity)
          : 0,
        reservedQuantity: 0,
        incomingQuantity: 0,
        ledgerCommitment: openCommitment,
        moq: Math.max(1, integer(profile?.moq) || 1),
        cartonQuantity: Math.max(1, integer(profile?.cartonQuantity) || 1),
      });
      const action = actionFor(inventory);
      const purchaseStatus = net.group;
      const recommendedQty = net.recommendedQuantity;
      const expectedCost = expectedCostForQuantity(
        product.expectedCost,
        originalRecommendedQty,
        recommendedQty,
      );
      const operationallyReady =
        purchaseStatus === "발주 추천" &&
        action === "NONE" &&
        inventoryUsable;

      return {
        barcode: key,
        name: text(product.name),
        modelNo: product.modelNo ? text(product.modelNo) : null,
        purchaseStatus,
        originalPurchaseStatus: text(product.status),
        recommendedQty,
        originalRecommendedQty,
        expectedCost,
        priorityScore: integer(product.score?.total),
        inventoryQuantity: inventory ? integer(inventory.inventoryQuantity) : 0,
        inventoryMode: mode,
        inventoryVerified: inventory?.inventoryVerified === true,
        inventoryVerification: text(inventory?.inventoryVerification) || "MISSING",
        inventoryRequiresReview: inventory?.inventoryRequiresReview === true,
        initialZeroUnverified: inventory?.initialZeroUnverified === true,
        inventoryBaselineKind: inventory?.inventoryBaselineKind ?? null,
        movementCount: integer(inventory?.movementCount),
        inboundMovementCount: integer(inventory?.inboundMovementCount),
        openCommitment,
        hasConfirmedReceiptCost: inventory?.hasConfirmedReceiptCost === true,
        latestConfirmedReceiptAt: inventory?.latestConfirmedReceiptAt ?? null,
        latestConfirmedReceiptCostKrw: integer(
          inventory?.latestConfirmedReceiptCostKrw,
        ),
        protectedCostKrw: integer(inventory?.protectedCostKrw),
        action,
        operationallyReady,
      };
    })
    .sort(
      (left, right) =>
        Number(right.purchaseStatus === "발주 추천") -
          Number(left.purchaseStatus === "발주 추천") ||
        Number(left.operationallyReady) - Number(right.operationallyReady) ||
        right.expectedCost - left.expectedCost ||
        right.priorityScore - left.priorityScore ||
        left.barcode.localeCompare(right.barcode),
    );

  const purchaseRows = rows.filter((row) => row.purchaseStatus === "발주 추천");
  const readyRows = purchaseRows.filter((row) => row.operationallyReady);
  const totalExpectedSpend = purchaseRows.reduce(
    (sum, row) => sum + row.expectedCost,
    0,
  );
  const operationallyReadyExpectedSpend = readyRows.reduce(
    (sum, row) => sum + row.expectedCost,
    0,
  );
  const blockedExpectedSpend = Math.max(
    0,
    totalExpectedSpend - operationallyReadyExpectedSpend,
  );
  const structuralReady =
    purchaseShadow.shadowReady &&
    purchaseProducts.length === inventoryReadiness.summary.managedActiveSkuCount &&
    rows.every(
      (row) => inventoryIndex.has(row.barcode) && planningIndex.has(row.barcode),
    );

  return {
    generatedAt: new Date().toISOString(),
    state: structuralReady ? "READY" : "BLOCKED",
    message: structuralReady
      ? "초기 0은 실제 0으로 확정하지 않고 PROVISIONAL 추정재고로 사용합니다. 확정입고는 추정재고와 원가에 즉시 반영하고, 품절 확인 시 SOLD_OUT_RESET=0부터 VERIFIED 원장으로 전환합니다. 재고실사는 운영 필수조건이 아닙니다."
      : "Canonical 발주 shadow·Product Master 재고원장·planning 연결이 완전하지 않아 발주 수량을 확정하지 않습니다.",
    purchaseShadowReady: purchaseShadow.shadowReady,
    managedActiveSkuCount: inventoryReadiness.summary.managedActiveSkuCount,
    purchaseRecommendationCount: purchaseRows.length,
    operationallyReadyPurchaseCount: readyRows.length,
    blockedPurchaseRecommendationCount: purchaseRows.length - readyRows.length,
    provisionalPurchaseCount: purchaseRows.filter(
      (row) => row.inventoryMode === "PROVISIONAL",
    ).length,
    verifiedPurchaseCount: purchaseRows.filter(
      (row) => row.inventoryMode === "VERIFIED",
    ).length,
    reviewInventoryCount: rows.filter(
      (row) => row.inventoryMode === "REVIEW" || row.inventoryMode === "MISSING",
    ).length,
    totalExpectedSpend,
    operationallyReadyExpectedSpend,
    blockedExpectedSpend,
    stocktakeRequiredCount: 0,
    writesEnabled: false,
    rows,
  };
}
