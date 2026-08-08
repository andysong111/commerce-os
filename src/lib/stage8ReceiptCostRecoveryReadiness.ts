import { createHash } from "node:crypto";
import {
  readPriceAdjustmentReceiptCache,
  type PriceAdjustmentReceipt,
} from "@/lib/priceAdjustmentReceiptCache";
import {
  loadInventoryVerificationPriority,
  type InventoryVerificationPriorityRow,
} from "@/lib/stage8InventoryVerificationPriority";

const DAY_MS = 24 * 60 * 60 * 1000;
const PROTECTED_COST_WINDOW_DAYS = 365;
const MAX_PROTECTED_RECEIPTS = 3;

export type ReceiptCostRecoveryState =
  | "ALREADY_CONFIRMED"
  | "CACHE_RECOVERABLE"
  | "NO_CACHE_EVIDENCE";

export type ReceiptCostRecoveryReadinessRow = {
  barcode: string;
  name: string;
  modelNo: string | null;
  purchaseStatus: string;
  recommendedQty: number;
  expectedCost: number;
  inventoryAction: InventoryVerificationPriorityRow["action"];
  inventoryVerified: boolean;
  initialZeroUnverified: boolean;
  productMasterHasConfirmedReceiptCost: boolean;
  cacheReceiptCount: number;
  cacheLatestReceivedAt: string | null;
  cacheLatestCostKrw: number;
  cacheProtectedCostKrw: number;
  costRecoveryState: ReceiptCostRecoveryState;
  stocktakeStillRequiredAfterCostRecovery: boolean;
};

export type ReceiptCostRecoveryReadiness = {
  generatedAt: string;
  state: "READY" | "BLOCKED";
  message: string;
  cacheComplete: boolean;
  cacheGeneratedAt: string | null;
  cacheUpdatedAt: string | null;
  cacheBarcodeCount: number;
  cacheReceiptCount: number;
  managedActiveSkuCount: number;
  purchaseRecommendationCount: number;
  purchaseCandidatesMissingProductMasterCost: number;
  purchaseCandidatesRecoverableFromCache: number;
  purchaseCandidatesWithoutCacheEvidence: number;
  recoverableExpectedSpend: number;
  noEvidenceExpectedSpend: number;
  stocktakeStillRequiredCountAfterCostRecovery: number;
  fingerprint: string;
  writesEnabled: false;
  rows: ReceiptCostRecoveryReadinessRow[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function validReceipt(row: PriceAdjustmentReceipt) {
  return (
    integer(row.quantity) > 0 &&
    integer(row.unitCostKrw) > 0 &&
    Number.isFinite(Date.parse(row.receivedAt))
  );
}

function receiptEvidence(rows: PriceAdjustmentReceipt[], nowMs: number) {
  const valid = rows
    .filter(validReceipt)
    .sort(
      (left, right) =>
        Date.parse(right.receivedAt) - Date.parse(left.receivedAt) ||
        right.id.localeCompare(left.id),
    );
  const protectedRows = valid
    .filter((row) => {
      const age = nowMs - Date.parse(row.receivedAt);
      return age >= 0 && age <= PROTECTED_COST_WINDOW_DAYS * DAY_MS;
    })
    .slice(0, MAX_PROTECTED_RECEIPTS);
  return {
    count: valid.length,
    latestReceivedAt: valid[0]?.receivedAt ?? null,
    latestCostKrw: integer(valid[0]?.unitCostKrw),
    protectedCostKrw: protectedRows.reduce(
      (max, row) => Math.max(max, integer(row.unitCostKrw)),
      0,
    ),
  };
}

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

export async function loadReceiptCostRecoveryReadiness(): Promise<ReceiptCostRecoveryReadiness> {
  const [priority, cache] = await Promise.all([
    loadInventoryVerificationPriority(),
    readPriceAdjustmentReceiptCache().catch(() => null),
  ]);
  const cacheComplete = cache?.complete === true;
  const nowMs = Date.now();
  const purchaseRows = priority.rows.filter(
    (row) => row.purchaseStatus === "발주 추천",
  );

  const rows = purchaseRows
    .map((row): ReceiptCostRecoveryReadinessRow => {
      const key = barcode(row.barcode);
      const evidence = receiptEvidence(
        cacheComplete ? cache?.receiptsByBarcode[key] ?? [] : [],
        nowMs,
      );
      const costRecoveryState: ReceiptCostRecoveryState = row.hasConfirmedReceiptCost
        ? "ALREADY_CONFIRMED"
        : evidence.count > 0
          ? "CACHE_RECOVERABLE"
          : "NO_CACHE_EVIDENCE";
      return {
        barcode: key,
        name: text(row.name),
        modelNo: row.modelNo ? text(row.modelNo) : null,
        purchaseStatus: row.purchaseStatus,
        recommendedQty: integer(row.recommendedQty),
        expectedCost: integer(row.expectedCost),
        inventoryAction: row.action,
        inventoryVerified: row.inventoryVerified,
        initialZeroUnverified: row.initialZeroUnverified,
        productMasterHasConfirmedReceiptCost: row.hasConfirmedReceiptCost,
        cacheReceiptCount: evidence.count,
        cacheLatestReceivedAt: evidence.latestReceivedAt,
        cacheLatestCostKrw: evidence.latestCostKrw,
        cacheProtectedCostKrw: evidence.protectedCostKrw,
        costRecoveryState,
        stocktakeStillRequiredAfterCostRecovery:
          !row.inventoryVerified || row.initialZeroUnverified,
      };
    })
    .sort(
      (left, right) =>
        Number(right.costRecoveryState === "CACHE_RECOVERABLE") -
          Number(left.costRecoveryState === "CACHE_RECOVERABLE") ||
        right.expectedCost - left.expectedCost ||
        left.barcode.localeCompare(right.barcode),
    );

  const missing = rows.filter(
    (row) => !row.productMasterHasConfirmedReceiptCost,
  );
  const recoverable = missing.filter(
    (row) => row.costRecoveryState === "CACHE_RECOVERABLE",
  );
  const noEvidence = missing.filter(
    (row) => row.costRecoveryState === "NO_CACHE_EVIDENCE",
  );
  const structuralReady = priority.state === "READY" && cacheComplete;
  const stableRows = rows.map((row) => ({
    barcode: row.barcode,
    expectedCost: row.expectedCost,
    inventoryAction: row.inventoryAction,
    cacheReceiptCount: row.cacheReceiptCount,
    cacheLatestReceivedAt: row.cacheLatestReceivedAt,
    cacheLatestCostKrw: row.cacheLatestCostKrw,
    cacheProtectedCostKrw: row.cacheProtectedCostKrw,
    costRecoveryState: row.costRecoveryState,
  }));

  return {
    generatedAt: new Date().toISOString(),
    state: structuralReady ? "READY" : "BLOCKED",
    message: structuralReady
      ? "기존 중국 입고원가 캐시와 Canonical 발주후보를 읽기 전용으로 결합했습니다. Product Master에 없는 원가 중 자동 복구 가능한 범위만 표시합니다."
      : "Canonical 발주후보 또는 중국 입고원가 캐시가 완전하지 않아 자동 복구 범위를 확정하지 않습니다.",
    cacheComplete,
    cacheGeneratedAt: cache?.generatedAt ?? null,
    cacheUpdatedAt: cache?.updatedAt ?? null,
    cacheBarcodeCount: cache?.barcodeCount ?? 0,
    cacheReceiptCount: cache?.receiptCount ?? 0,
    managedActiveSkuCount: priority.managedActiveSkuCount,
    purchaseRecommendationCount: purchaseRows.length,
    purchaseCandidatesMissingProductMasterCost: missing.length,
    purchaseCandidatesRecoverableFromCache: recoverable.length,
    purchaseCandidatesWithoutCacheEvidence: noEvidence.length,
    recoverableExpectedSpend: recoverable.reduce(
      (sum, row) => sum + row.expectedCost,
      0,
    ),
    noEvidenceExpectedSpend: noEvidence.reduce(
      (sum, row) => sum + row.expectedCost,
      0,
    ),
    stocktakeStillRequiredCountAfterCostRecovery: rows.filter(
      (row) => row.stocktakeStillRequiredAfterCostRecovery,
    ).length,
    fingerprint: fingerprint({
      cacheSnapshotId: cache?.snapshotId ?? null,
      cacheGeneratedAt: cache?.generatedAt ?? null,
      priorityGeneratedAt: priority.generatedAt,
      rows: stableRows,
    }),
    writesEnabled: false,
    rows,
  };
}
