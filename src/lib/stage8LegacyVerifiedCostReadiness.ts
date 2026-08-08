import { createHash } from "node:crypto";
import { legacyVerifiedPurchaseCostEvidenceByBarcode } from "@/data/stage8LegacyVerifiedCostEvidence";
import {
  loadInventoryVerificationPriority,
  type InventoryVerificationPriorityRow,
} from "@/lib/stage8InventoryVerificationPriority";

export type PurchaseCostTrustSource =
  | "CONFIRMED_RECEIPT"
  | "LEGACY_VERIFIED_COST_EVIDENCE"
  | "UNTRUSTED";

export type LegacyVerifiedCostReadinessRow = {
  barcode: string;
  name: string;
  modelNo: string | null;
  recommendedQty: number;
  shadowExpectedCost: number;
  shadowImpliedUnitCostKrw: number;
  productMasterHasConfirmedReceiptCost: boolean;
  evidenceModelNo: string | null;
  evidenceOptionName: string | null;
  evidenceUnitCostKrw: number;
  evidenceCostDate: string | null;
  evidenceSourceWorkbook: string | null;
  evidenceSourceSheet: string | null;
  evidenceConfidence: "A" | null;
  effectivePurchaseUnitCostKrw: number;
  effectivePurchaseExpectedCost: number;
  purchaseCostTrustSource: PurchaseCostTrustSource;
  purchaseCostTrusted: boolean;
  inventoryVerified: boolean;
  initialZeroUnverified: boolean;
  inventoryRequiresReview: boolean;
  immediateStocktakeEligible: boolean;
  operationallyReady: boolean;
  priceUseAllowed: false;
  confirmedReceiptUseAllowed: false;
  writesEnabled: false;
};

export type LegacyVerifiedCostReadiness = {
  generatedAt: string;
  state: "READY" | "BLOCKED";
  message: string;
  purchaseCandidateCount: number;
  confirmedReceiptCostCount: number;
  legacyVerifiedCostCount: number;
  costTrustedPurchaseCandidateCount: number;
  costBlockedPurchaseCandidateCount: number;
  immediateStocktakeEligibleCount: number;
  operationallyReadyCount: number;
  shadowExpectedSpend: number;
  costTrustedShadowSpend: number;
  costTrustedConservativeSpend: number;
  immediateStocktakeConservativeSpend: number;
  fingerprint: string;
  priceUseAllowed: false;
  confirmedReceiptUseAllowed: false;
  inventoryWritesEnabled: false;
  businessWritesEnabled: false;
  rows: LegacyVerifiedCostReadinessRow[];
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

function impliedUnitCost(row: InventoryVerificationPriorityRow) {
  const quantity = integer(row.recommendedQty);
  const expected = integer(row.expectedCost);
  if (!quantity || !expected) return 0;
  return Math.ceil(expected / quantity);
}

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

export async function loadLegacyVerifiedCostReadiness(): Promise<LegacyVerifiedCostReadiness> {
  const priority = await loadInventoryVerificationPriority();
  const evidenceByBarcode = legacyVerifiedPurchaseCostEvidenceByBarcode();
  const purchaseCandidates = priority.rows.filter(
    (row) => row.purchaseStatus === "발주 추천",
  );

  const rows = purchaseCandidates
    .map((row): LegacyVerifiedCostReadinessRow => {
      const key = barcode(row.barcode);
      const evidence = evidenceByBarcode.get(key) ?? null;
      const shadowUnitCost = impliedUnitCost(row);
      const confirmedReceipt = row.hasConfirmedReceiptCost;
      const legacyVerified = Boolean(evidence?.purchaseUseAllowed);
      const purchaseCostTrustSource: PurchaseCostTrustSource = confirmedReceipt
        ? "CONFIRMED_RECEIPT"
        : legacyVerified
          ? "LEGACY_VERIFIED_COST_EVIDENCE"
          : "UNTRUSTED";
      const evidenceCost = evidence ? Math.ceil(evidence.unitCostKrw) : 0;
      const effectivePurchaseUnitCostKrw = confirmedReceipt
        ? Math.max(1, integer(row.protectedCostKrw || row.latestCostKrw || shadowUnitCost))
        : legacyVerified
          ? Math.max(shadowUnitCost, evidenceCost)
          : 0;
      const recommendedQty = integer(row.recommendedQty);
      const purchaseCostTrusted = purchaseCostTrustSource !== "UNTRUSTED";
      const inventoryVerified = row.inventoryVerified && !row.inventoryRequiresReview;
      const immediateStocktakeEligible =
        purchaseCostTrusted && !inventoryVerified && !row.inventoryRequiresReview;
      const operationallyReady = purchaseCostTrusted && inventoryVerified;
      return {
        barcode: key,
        name: text(row.name),
        modelNo: row.modelNo ? text(row.modelNo) : null,
        recommendedQty,
        shadowExpectedCost: integer(row.expectedCost),
        shadowImpliedUnitCostKrw: shadowUnitCost,
        productMasterHasConfirmedReceiptCost: confirmedReceipt,
        evidenceModelNo: evidence?.modelNo ?? null,
        evidenceOptionName: evidence?.optionName ?? null,
        evidenceUnitCostKrw: evidenceCost,
        evidenceCostDate: evidence?.costDate ?? null,
        evidenceSourceWorkbook: evidence?.sourceWorkbook ?? null,
        evidenceSourceSheet: evidence?.sourceSheet ?? null,
        evidenceConfidence: evidence?.confidence ?? null,
        effectivePurchaseUnitCostKrw,
        effectivePurchaseExpectedCost:
          effectivePurchaseUnitCostKrw * recommendedQty,
        purchaseCostTrustSource,
        purchaseCostTrusted,
        inventoryVerified,
        initialZeroUnverified: row.initialZeroUnverified,
        inventoryRequiresReview: row.inventoryRequiresReview,
        immediateStocktakeEligible,
        operationallyReady,
        priceUseAllowed: false,
        confirmedReceiptUseAllowed: false,
        writesEnabled: false,
      };
    })
    .sort(
      (left, right) =>
        Number(right.immediateStocktakeEligible) -
          Number(left.immediateStocktakeEligible) ||
        right.effectivePurchaseExpectedCost - left.effectivePurchaseExpectedCost ||
        right.shadowExpectedCost - left.shadowExpectedCost ||
        left.barcode.localeCompare(right.barcode),
    );

  const trusted = rows.filter((row) => row.purchaseCostTrusted);
  const immediate = rows.filter((row) => row.immediateStocktakeEligible);
  const stableRows = rows.map((row) => ({
    barcode: row.barcode,
    recommendedQty: row.recommendedQty,
    shadowExpectedCost: row.shadowExpectedCost,
    evidenceModelNo: row.evidenceModelNo,
    evidenceUnitCostKrw: row.evidenceUnitCostKrw,
    evidenceCostDate: row.evidenceCostDate,
    effectivePurchaseUnitCostKrw: row.effectivePurchaseUnitCostKrw,
    purchaseCostTrustSource: row.purchaseCostTrustSource,
    inventoryVerified: row.inventoryVerified,
    immediateStocktakeEligible: row.immediateStocktakeEligible,
  }));

  return {
    generatedAt: new Date().toISOString(),
    state: priority.state === "READY" ? "READY" : "BLOCKED",
    message:
      "과거 원가를 확정입고로 가장하지 않고 발주비용 신뢰도에만 별도 사용합니다. 기존 shadow 원가보다 낮은 역사 원가는 비용을 낮추지 않으며, 검증원가가 더 높을 때만 보수적으로 상향합니다. 가격·재고·확정입고 원장은 계속 잠깁니다.",
    purchaseCandidateCount: rows.length,
    confirmedReceiptCostCount: rows.filter(
      (row) => row.purchaseCostTrustSource === "CONFIRMED_RECEIPT",
    ).length,
    legacyVerifiedCostCount: rows.filter(
      (row) =>
        row.purchaseCostTrustSource === "LEGACY_VERIFIED_COST_EVIDENCE",
    ).length,
    costTrustedPurchaseCandidateCount: trusted.length,
    costBlockedPurchaseCandidateCount: rows.length - trusted.length,
    immediateStocktakeEligibleCount: immediate.length,
    operationallyReadyCount: rows.filter((row) => row.operationallyReady).length,
    shadowExpectedSpend: rows.reduce(
      (sum, row) => sum + row.shadowExpectedCost,
      0,
    ),
    costTrustedShadowSpend: trusted.reduce(
      (sum, row) => sum + row.shadowExpectedCost,
      0,
    ),
    costTrustedConservativeSpend: trusted.reduce(
      (sum, row) => sum + row.effectivePurchaseExpectedCost,
      0,
    ),
    immediateStocktakeConservativeSpend: immediate.reduce(
      (sum, row) => sum + row.effectivePurchaseExpectedCost,
      0,
    ),
    fingerprint: fingerprint({
      priorityGeneratedAt: priority.generatedAt,
      evidence: [...evidenceByBarcode.values()].map((row) => ({
        barcode: row.barcode,
        modelNo: row.modelNo,
        optionName: row.optionName,
        unitCostKrw: row.unitCostKrw,
        costDate: row.costDate,
      })),
      rows: stableRows,
    }),
    priceUseAllowed: false,
    confirmedReceiptUseAllowed: false,
    inventoryWritesEnabled: false,
    businessWritesEnabled: false,
    rows,
  };
}
