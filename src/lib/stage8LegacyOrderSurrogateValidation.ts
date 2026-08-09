import { createHash } from "node:crypto";
import { legacyOrderSurrogateValidationEvidence } from "@/data/stage8LegacyOrderSurrogateValidationEvidence";
import { provisionalInventoryValidationEvidenceByBarcode } from "@/data/stage8ProvisionalInventoryValidationEvidence";
import { loadProductMasterCanonicalSalesAudit } from "@/lib/productMasterCanonicalSalesAudit";
import { loadProductMasterInventoryCostReadiness } from "@/lib/productMasterInventoryCostReadiness";

export type LegacyOrderSurrogateValidationRow = {
  barcode: string;
  modelNumber: string;
  productName: string;
  sourceKind: "LEGACY_ORDER_HISTORY_WORKBOOK";
  sourceArtifact: string;
  cumulativeOrderedQuantity: number;
  validOrderRecordCount: number;
  latestOrderDate: string;
  canonicalWindowStart: string;
  canonicalWindowEnd: string;
  canonical360SalesQuantity: number;
  productMasterMonthlySalesQuantity: number;
  diagnosticOrderMinusCanonicalSales: number;
  physicalValidationQuantity: number | null;
  physicalObservedOn: string | null;
  diagnosticDeltaToPhysical: number | null;
  diagnosticAbsoluteErrorPct: number | null;
  unexplainedQuantityBeforePromotion: number | null;
  confirmedInbound: false;
  inventoryUseAllowed: false;
  operationalEstimateAllowed: false;
  inventoryWritesEnabled: false;
  conclusion:
    | "INSUFFICIENT_FOR_OPERATIONAL_ESTIMATE"
    | "CANONICAL_SALES_ROW_MISSING"
    | "PHYSICAL_VALIDATION_MISSING";
};

export type LegacyOrderSurrogateValidation = {
  generatedAt: string;
  state: "READY_VALIDATION_ONLY" | "BLOCKED";
  message: string;
  analysisAsOf: string | null;
  canonicalAuditReady: boolean;
  rowCount: number;
  rows: LegacyOrderSurrogateValidationRow[];
  fingerprint: string;
  operationalEstimatePromotionAllowed: false;
  inventoryWritesEnabled: false;
};

function normalizeBarcode(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().toUpperCase();
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + Math.max(0, Math.round(Number(value) || 0)), 0);
}

function shiftDays(iso: string, days: number) {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed + days * 86_400_000).toISOString();
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export async function loadLegacyOrderSurrogateValidation(): Promise<LegacyOrderSurrogateValidation> {
  const [canonical, inventory] = await Promise.all([
    loadProductMasterCanonicalSalesAudit(),
    loadProductMasterInventoryCostReadiness(),
  ]);
  const physicalByBarcode = provisionalInventoryValidationEvidenceByBarcode();
  const canonicalByBarcode = new Map(
    (canonical.snapshot?.rows ?? []).map((row) => [normalizeBarcode(row.barcode), row] as const),
  );
  const monthlyByBarcode = new Map(
    inventory.rows.map((row) => [normalizeBarcode(row.barcode), row] as const),
  );
  const analysisAsOf = canonical.analysisAsOf ?? canonical.snapshot?.analysisAsOf ?? null;
  const canonicalWindowStart = analysisAsOf ? shiftDays(analysisAsOf, -360) : "";
  const canonicalWindowEnd = analysisAsOf ?? "";

  const rows = legacyOrderSurrogateValidationEvidence().map(
    (source): LegacyOrderSurrogateValidationRow => {
      const barcode = normalizeBarcode(source.barcode);
      const canonicalRow = canonicalByBarcode.get(barcode) ?? null;
      const monthlyRow = monthlyByBarcode.get(barcode) ?? null;
      const physical = physicalByBarcode.get(barcode) ?? null;
      const canonical360SalesQuantity = canonicalRow
        ? sum(canonicalRow.monthlyUnits)
        : 0;
      const productMasterMonthlySalesQuantity = Math.max(
        0,
        Math.round(Number(monthlyRow?.salesQuantityTotal) || 0),
      );
      const diagnosticOrderMinusCanonicalSales =
        source.cumulativeOrderedQuantity - canonical360SalesQuantity;
      const diagnosticDeltaToPhysical = physical
        ? diagnosticOrderMinusCanonicalSales - physical.physicalQuantity
        : null;
      const diagnosticAbsoluteErrorPct =
        physical && physical.physicalQuantity > 0 && diagnosticDeltaToPhysical !== null
          ? Math.round(
              (Math.abs(diagnosticDeltaToPhysical) / physical.physicalQuantity) * 10_000,
            ) / 100
          : null;
      const unexplainedQuantityBeforePromotion =
        physical && diagnosticDeltaToPhysical !== null
          ? diagnosticDeltaToPhysical
          : null;
      const conclusion = !canonicalRow
        ? "CANONICAL_SALES_ROW_MISSING"
        : !physical
          ? "PHYSICAL_VALIDATION_MISSING"
          : "INSUFFICIENT_FOR_OPERATIONAL_ESTIMATE";
      return {
        barcode,
        modelNumber: source.modelNumber,
        productName: source.productName,
        sourceKind: source.sourceKind,
        sourceArtifact: source.sourceArtifact,
        cumulativeOrderedQuantity: source.cumulativeOrderedQuantity,
        validOrderRecordCount: source.validOrderRecordCount,
        latestOrderDate: source.latestOrderDate,
        canonicalWindowStart,
        canonicalWindowEnd,
        canonical360SalesQuantity,
        productMasterMonthlySalesQuantity,
        diagnosticOrderMinusCanonicalSales,
        physicalValidationQuantity: physical?.physicalQuantity ?? null,
        physicalObservedOn: physical?.observedOn ?? null,
        diagnosticDeltaToPhysical,
        diagnosticAbsoluteErrorPct,
        unexplainedQuantityBeforePromotion,
        confirmedInbound: false,
        inventoryUseAllowed: false,
        operationalEstimateAllowed: false,
        inventoryWritesEnabled: false,
        conclusion,
      };
    },
  );

  const ready = canonical.ready && Boolean(analysisAsOf) && rows.length > 0;
  const stable = rows.map((row) => ({
    barcode: row.barcode,
    cumulativeOrderedQuantity: row.cumulativeOrderedQuantity,
    latestOrderDate: row.latestOrderDate,
    canonicalWindowStart: row.canonicalWindowStart,
    canonicalWindowEnd: row.canonicalWindowEnd,
    canonical360SalesQuantity: row.canonical360SalesQuantity,
    productMasterMonthlySalesQuantity: row.productMasterMonthlySalesQuantity,
    diagnosticOrderMinusCanonicalSales: row.diagnosticOrderMinusCanonicalSales,
    physicalValidationQuantity: row.physicalValidationQuantity,
    diagnosticDeltaToPhysical: row.diagnosticDeltaToPhysical,
    conclusion: row.conclusion,
  }));

  return {
    generatedAt: new Date().toISOString(),
    state: ready ? "READY_VALIDATION_ONLY" : "BLOCKED",
    message: ready
      ? "과거 발주수량은 확정입고가 아니므로 실제 재고로 쓰지 않습니다. 12×30일 Canonical 판매와 실물 검증값을 대조해, 과거 판매 누락 또는 미입고·취소 가능성을 먼저 수치로 분리합니다."
      : "Canonical 판매원장이 준비되지 않아 과거 발주수량 대조를 차단했습니다.",
    analysisAsOf,
    canonicalAuditReady: canonical.ready,
    rowCount: rows.length,
    rows,
    fingerprint: sha256({
      canonicalFingerprint: canonical.snapshot?.contentFingerprint ?? null,
      inventoryFingerprint: inventory.contentFingerprint,
      rows: stable,
    }),
    operationalEstimatePromotionAllowed: false,
    inventoryWritesEnabled: false,
  };
}
