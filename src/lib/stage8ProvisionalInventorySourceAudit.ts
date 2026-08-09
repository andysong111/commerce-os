import { createHash } from "node:crypto";
import { provisionalInventoryValidationEvidenceByBarcode } from "@/data/stage8ProvisionalInventoryValidationEvidence";
import {
  loadProductMasterInventoryCostReadiness,
  type ProductMasterInventoryCostRow,
} from "@/lib/productMasterInventoryCostReadiness";
import { loadInventoryVerificationPriority } from "@/lib/stage8InventoryVerificationPriority";

export type ProvisionalInventoryEvidenceState =
  | "VERIFIED"
  | "REVIEW"
  | "SOURCE_FIELDS_NOT_DEPLOYED"
  | "NO_QUANTITY_HISTORY"
  | "SALES_WITHOUT_INBOUND"
  | "INBOUND_WITHOUT_SALES"
  | "QUANTITY_HISTORY_PRESENT_BASELINE_UNPROVEN";

export type ProvisionalInventorySourceAuditRow = {
  barcode: string;
  purchaseCandidate: boolean;
  currentInventoryQuantity: number;
  inventoryVerified: boolean;
  inventoryBaselineKind: string | null;
  initialZeroUnverified: boolean;
  inventoryRequiresReview: boolean;
  inboundQuantityTotal: number;
  receiptQuantityTotal: number;
  salesQuantityTotal: number;
  diagnosticNetQuantity: number | null;
  firstInboundAt: string | null;
  lastInboundAt: string | null;
  firstSalesMonth: string | null;
  lastSalesMonth: string | null;
  movementSourceCounts: Record<string, number>;
  movementSourceQuantityTotals: Record<string, number>;
  receiptSourceCounts: Record<string, number>;
  salesSourceCounts: Record<string, number>;
  evidenceState: ProvisionalInventoryEvidenceState;
  physicalValidationQuantity: number | null;
  physicalValidationObservedOn: string | null;
  validationDeltaUnits: number | null;
  validationAbsoluteErrorPct: number | null;
  validationOnly: boolean;
  operationalEstimateAllowed: false;
  inventoryWritesEnabled: false;
};

export type ProvisionalInventorySourceAudit = {
  generatedAt: string;
  state: "READY_FOR_SOURCE_REVIEW" | "WAITING_FOR_PRODUCT_MASTER_SCHEMA";
  message: string;
  productMasterFingerprint: string;
  managedActiveSkuCount: number;
  purchaseCandidateCount: number;
  managedSkuWithInboundEvidenceCount: number;
  managedSkuWithSalesHistoryCount: number;
  purchaseCandidateWithInboundEvidenceCount: number;
  purchaseCandidateWithSalesHistoryCount: number;
  purchaseCandidateWithBothEvidenceCount: number;
  purchaseCandidateBaselineUnprovenCount: number;
  purchaseCandidateNoInboundCount: number;
  validationSampleCount: number;
  fingerprint: string;
  operationalEstimatePromotionAllowed: false;
  inventoryWritesEnabled: false;
  rows: ProvisionalInventorySourceAuditRow[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, number>)
    : {};
}

function deployedSourceFields(row: ProductMasterInventoryCostRow) {
  return (
    typeof row.inboundQuantityTotal === "number" &&
    typeof row.salesQuantityTotal === "number" &&
    typeof row.salesMonthlyRowCount === "number"
  );
}

function evidenceState(row: ProductMasterInventoryCostRow): ProvisionalInventoryEvidenceState {
  if (row.inventoryVerified && !row.inventoryRequiresReview) return "VERIFIED";
  if (row.inventoryRequiresReview) return "REVIEW";
  if (!deployedSourceFields(row)) return "SOURCE_FIELDS_NOT_DEPLOYED";
  const inbound = integer(row.inboundQuantityTotal);
  const sales = integer(row.salesQuantityTotal);
  if (!inbound && !sales) return "NO_QUANTITY_HISTORY";
  if (!inbound) return "SALES_WITHOUT_INBOUND";
  if (!sales) return "INBOUND_WITHOUT_SALES";
  return "QUANTITY_HISTORY_PRESENT_BASELINE_UNPROVEN";
}

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

export async function loadProvisionalInventorySourceAudit(): Promise<ProvisionalInventorySourceAudit> {
  const [inventory, priority] = await Promise.all([
    loadProductMasterInventoryCostReadiness(),
    loadInventoryVerificationPriority(),
  ]);
  const validation = provisionalInventoryValidationEvidenceByBarcode();
  const purchaseBarcodes = new Set(
    priority.rows
      .filter((row) => row.purchaseStatus === "발주 추천")
      .map((row) => barcode(row.barcode)),
  );
  const sourceFieldsDeployed = inventory.rows.every(deployedSourceFields);

  const rows = inventory.rows
    .map((row): ProvisionalInventorySourceAuditRow => {
      const key = barcode(row.barcode);
      const inbound = integer(row.inboundQuantityTotal);
      const receipts = integer(row.receiptQuantityTotal);
      const sales = integer(row.salesQuantityTotal);
      const sourceReady = deployedSourceFields(row);
      const diagnosticNetQuantity = sourceReady ? inbound - sales : null;
      const sample = validation.get(key) ?? null;
      const validationDeltaUnits =
        sample && diagnosticNetQuantity !== null
          ? diagnosticNetQuantity - sample.physicalQuantity
          : null;
      const validationAbsoluteErrorPct =
        sample && diagnosticNetQuantity !== null && sample.physicalQuantity > 0
          ? Math.round(
              (Math.abs(validationDeltaUnits ?? 0) / sample.physicalQuantity) *
                10_000,
            ) / 100
          : null;
      return {
        barcode: key,
        purchaseCandidate: purchaseBarcodes.has(key),
        currentInventoryQuantity: integer(row.inventoryQuantity),
        inventoryVerified: row.inventoryVerified === true,
        inventoryBaselineKind: row.inventoryBaselineKind ?? null,
        initialZeroUnverified: row.initialZeroUnverified === true,
        inventoryRequiresReview: row.inventoryRequiresReview === true,
        inboundQuantityTotal: inbound,
        receiptQuantityTotal: receipts,
        salesQuantityTotal: sales,
        diagnosticNetQuantity,
        firstInboundAt: row.firstInboundAt ?? null,
        lastInboundAt: row.lastInboundAt ?? null,
        firstSalesMonth: row.firstSalesMonth ?? null,
        lastSalesMonth: row.lastSalesMonth ?? null,
        movementSourceCounts: record(row.movementSourceCounts),
        movementSourceQuantityTotals: record(row.movementSourceQuantityTotals),
        receiptSourceCounts: record(row.receiptSourceCounts),
        salesSourceCounts: record(row.salesSourceCounts),
        evidenceState: evidenceState(row),
        physicalValidationQuantity: sample?.physicalQuantity ?? null,
        physicalValidationObservedOn: sample?.observedOn ?? null,
        validationDeltaUnits,
        validationAbsoluteErrorPct,
        validationOnly: Boolean(sample),
        operationalEstimateAllowed: false,
        inventoryWritesEnabled: false,
      };
    })
    .sort(
      (left, right) =>
        Number(right.purchaseCandidate) - Number(left.purchaseCandidate) ||
        left.barcode.localeCompare(right.barcode),
    );

  const purchaseRows = rows.filter((row) => row.purchaseCandidate);
  const purchaseCandidateWithInboundEvidenceCount = purchaseRows.filter(
    (row) => row.inboundQuantityTotal > 0,
  ).length;
  const purchaseCandidateWithSalesHistoryCount = purchaseRows.filter(
    (row) => row.salesQuantityTotal > 0,
  ).length;
  const purchaseCandidateWithBothEvidenceCount = purchaseRows.filter(
    (row) => row.inboundQuantityTotal > 0 && row.salesQuantityTotal > 0,
  ).length;
  const purchaseCandidateBaselineUnprovenCount = purchaseRows.filter(
    (row) => row.evidenceState === "QUANTITY_HISTORY_PRESENT_BASELINE_UNPROVEN",
  ).length;
  const stable = rows.map((row) => ({
    barcode: row.barcode,
    purchaseCandidate: row.purchaseCandidate,
    currentInventoryQuantity: row.currentInventoryQuantity,
    inventoryVerified: row.inventoryVerified,
    inventoryBaselineKind: row.inventoryBaselineKind,
    inboundQuantityTotal: row.inboundQuantityTotal,
    receiptQuantityTotal: row.receiptQuantityTotal,
    salesQuantityTotal: row.salesQuantityTotal,
    diagnosticNetQuantity: row.diagnosticNetQuantity,
    firstInboundAt: row.firstInboundAt,
    lastInboundAt: row.lastInboundAt,
    firstSalesMonth: row.firstSalesMonth,
    lastSalesMonth: row.lastSalesMonth,
    evidenceState: row.evidenceState,
    physicalValidationQuantity: row.physicalValidationQuantity,
  }));

  return {
    generatedAt: new Date().toISOString(),
    state: sourceFieldsDeployed
      ? "READY_FOR_SOURCE_REVIEW"
      : "WAITING_FOR_PRODUCT_MASTER_SCHEMA",
    message: sourceFieldsDeployed
      ? "과거 입고·판매 수량 증거를 읽었지만 공통 시작재고 기준이 증명되기 전까지 단순 입고-판매 차이를 운영 추정재고로 승격하지 않습니다. BGG1-1 실물 3,000개는 검증 표본으로만 비교합니다."
      : "Product Master 운영 배포가 새 수량 증거 필드를 제공할 때까지 기다립니다. 현재 재고값이나 발주값은 변경하지 않습니다.",
    productMasterFingerprint: inventory.contentFingerprint,
    managedActiveSkuCount: rows.length,
    purchaseCandidateCount: purchaseRows.length,
    managedSkuWithInboundEvidenceCount: rows.filter(
      (row) => row.inboundQuantityTotal > 0,
    ).length,
    managedSkuWithSalesHistoryCount: rows.filter(
      (row) => row.salesQuantityTotal > 0,
    ).length,
    purchaseCandidateWithInboundEvidenceCount,
    purchaseCandidateWithSalesHistoryCount,
    purchaseCandidateWithBothEvidenceCount,
    purchaseCandidateBaselineUnprovenCount,
    purchaseCandidateNoInboundCount:
      purchaseRows.length - purchaseCandidateWithInboundEvidenceCount,
    validationSampleCount: rows.filter(
      (row) => row.physicalValidationQuantity !== null,
    ).length,
    fingerprint: fingerprint({
      productMasterFingerprint: inventory.contentFingerprint,
      purchaseBarcodes: [...purchaseBarcodes].sort(),
      rows: stable,
    }),
    operationalEstimatePromotionAllowed: false,
    inventoryWritesEnabled: false,
    rows,
  };
}
