import { loadCanonicalPurchaseShadow } from "@/lib/stage8CanonicalPurchaseShadow";
import {
  loadProductMasterInventoryCostReadiness,
  type ProductMasterInventoryCostRow,
} from "@/lib/productMasterInventoryCostReadiness";

export type InventoryVerificationPriorityRow = {
  barcode: string;
  name: string;
  modelNo: string | null;
  purchaseStatus: string;
  recommendedQty: number;
  expectedCost: number;
  priorityScore: number;
  inventoryQuantity: number;
  inventoryVerified: boolean;
  inventoryVerification: string;
  inventoryRequiresReview: boolean;
  initialZeroUnverified: boolean;
  inventoryBaselineKind: string | null;
  movementCount: number;
  inboundMovementCount: number;
  hasConfirmedReceiptCost: boolean;
  latestConfirmedReceiptAt: string | null;
  latestConfirmedReceiptCostKrw: number;
  protectedCostKrw: number;
  action:
    | "NONE"
    | "STOCKTAKE_REQUIRED"
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
  verifiedPurchaseRecommendationCount: number;
  blockedPurchaseRecommendationCount: number;
  totalExpectedSpend: number;
  operationallyReadyExpectedSpend: number;
  blockedExpectedSpend: number;
  priorityStocktakeCountFor80PctBlockedSpend: number;
  priorityStocktakeExpectedSpendCoverage: number;
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

function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function inventoryByBarcode(rows: ProductMasterInventoryCostRow[]) {
  return new Map(rows.map((row) => [barcode(row.barcode), row]));
}

function actionFor(row: ProductMasterInventoryCostRow | undefined) {
  if (!row) return "LEDGER_REVIEW_REQUIRED" as const;
  if (row.inventoryRequiresReview) return "LEDGER_REVIEW_REQUIRED" as const;
  if (!row.inventoryVerified || row.initialZeroUnverified) {
    return "STOCKTAKE_REQUIRED" as const;
  }
  if (!row.hasConfirmedReceiptCost) {
    return "COST_CONFIRMATION_REQUIRED" as const;
  }
  return "NONE" as const;
}

function spendCoverageCount(rows: InventoryVerificationPriorityRow[], target = 0.8) {
  const candidates = rows
    .filter((row) => row.purchaseStatus === "발주 추천" && !row.operationallyReady)
    .sort(
      (left, right) =>
        right.expectedCost - left.expectedCost ||
        right.priorityScore - left.priorityScore ||
        left.barcode.localeCompare(right.barcode),
    );
  const blockedSpend = candidates.reduce((sum, row) => sum + row.expectedCost, 0);
  if (!(blockedSpend > 0)) return { count: 0, coverageSpend: 0 };
  const targetSpend = blockedSpend * target;
  let coverageSpend = 0;
  let count = 0;
  for (const row of candidates) {
    coverageSpend += row.expectedCost;
    count += 1;
    if (coverageSpend >= targetSpend) break;
  }
  return { count, coverageSpend };
}

export async function loadInventoryVerificationPriority(): Promise<InventoryVerificationPriority> {
  const [purchaseShadow, inventoryReadiness] = await Promise.all([
    loadCanonicalPurchaseShadow(),
    loadProductMasterInventoryCostReadiness(),
  ]);
  const purchaseProducts = purchaseShadow.snapshot?.products ?? [];
  const inventoryIndex = inventoryByBarcode(inventoryReadiness.rows);

  const rows: InventoryVerificationPriorityRow[] = purchaseProducts
    .map((product) => {
      const key = barcode(product.barcode);
      const inventory = inventoryIndex.get(key);
      const action = actionFor(inventory);
      const operationallyReady =
        product.status === "발주 추천" &&
        action === "NONE" &&
        product.inventoryKnown === true;
      return {
        barcode: key,
        name: text(product.name),
        modelNo: product.modelNo ? text(product.modelNo) : null,
        purchaseStatus: text(product.status),
        recommendedQty: Math.max(0, Math.round(number(product.recommendedQty))),
        expectedCost: Math.max(0, Math.round(number(product.expectedCost))),
        priorityScore: Math.max(0, Math.round(number(product.score?.total))),
        inventoryQuantity: inventory ? Math.round(number(inventory.inventoryQuantity)) : 0,
        inventoryVerified: inventory?.inventoryVerified === true,
        inventoryVerification: text(inventory?.inventoryVerification) || "MISSING",
        inventoryRequiresReview: inventory?.inventoryRequiresReview === true,
        initialZeroUnverified: inventory?.initialZeroUnverified === true,
        inventoryBaselineKind: inventory?.inventoryBaselineKind ?? null,
        movementCount: Math.max(0, Math.round(number(inventory?.movementCount))),
        inboundMovementCount: Math.max(0, Math.round(number(inventory?.inboundMovementCount))),
        hasConfirmedReceiptCost: inventory?.hasConfirmedReceiptCost === true,
        latestConfirmedReceiptAt: inventory?.latestConfirmedReceiptAt ?? null,
        latestConfirmedReceiptCostKrw: Math.max(
          0,
          Math.round(number(inventory?.latestConfirmedReceiptCostKrw)),
        ),
        protectedCostKrw: Math.max(0, Math.round(number(inventory?.protectedCostKrw))),
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
  const totalExpectedSpend = purchaseRows.reduce((sum, row) => sum + row.expectedCost, 0);
  const operationallyReadyExpectedSpend = readyRows.reduce(
    (sum, row) => sum + row.expectedCost,
    0,
  );
  const blockedExpectedSpend = Math.max(
    0,
    totalExpectedSpend - operationallyReadyExpectedSpend,
  );
  const coverage = spendCoverageCount(rows);
  const structuralReady =
    purchaseShadow.shadowReady &&
    purchaseProducts.length === inventoryReadiness.summary.managedActiveSkuCount &&
    rows.every((row) => inventoryIndex.has(row.barcode));

  return {
    generatedAt: new Date().toISOString(),
    state: structuralReady ? "READY" : "BLOCKED",
    message: structuralReady
      ? "Canonical 발주 shadow와 Product Master 재고·원가 원장을 1:1로 결합했습니다. 실제 발주 후보 중 확인이 필요한 SKU만 기대발주금액 순으로 최소화해 표시합니다."
      : "Canonical 발주 shadow와 재고·원가 원장 간 구조 불일치가 있어 실사 우선순위를 확정하지 않습니다.",
    purchaseShadowReady: purchaseShadow.shadowReady,
    managedActiveSkuCount: inventoryReadiness.summary.managedActiveSkuCount,
    purchaseRecommendationCount: purchaseRows.length,
    verifiedPurchaseRecommendationCount: readyRows.length,
    blockedPurchaseRecommendationCount: purchaseRows.length - readyRows.length,
    totalExpectedSpend,
    operationallyReadyExpectedSpend,
    blockedExpectedSpend,
    priorityStocktakeCountFor80PctBlockedSpend: coverage.count,
    priorityStocktakeExpectedSpendCoverage: coverage.coverageSpend,
    writesEnabled: false,
    rows,
  };
}
