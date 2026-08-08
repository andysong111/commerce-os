import { createHash } from "node:crypto";
import {
  aggregateProductMasterShoplingSalesEventChunk,
  type ProductMasterSalesEventRow,
} from "@/lib/productMasterShoplingSalesEventEngine";
import {
  aggregateShoplingOrderChunk,
  type ProductPlanningSnapshot,
  type ShoplingOrderProductAggregate,
} from "@/lib/shopling/shoplingLiveAggregation";
import {
  normalizeShoplingBarcode,
  normalizeShoplingOrder,
  type ShoplingRawRow,
} from "@/lib/shopling/shoplingNormalize";
import type { ShoplingDateRange } from "@/lib/shopling/shoplingReadClient";

const MANAGED_BARCODE = /^B[A-Z]{2}\d+-\d+$/;
const MAX_EVIDENCE_PER_CHUNK = 500;

export type DemandMismatchCategory =
  | "LEGACY_ACCEPTS_CANONICAL_IGNORES"
  | "LEGACY_ACCEPTS_CANONICAL_UNMAPPED"
  | "CANONICAL_ONLY_LEGACY_IGNORES"
  | "CANONICAL_ONLY_LEGACY_UNMAPPED"
  | "LEGACY_SKU_DIFFERS_FROM_CANONICAL"
  | "LEGACY_QTY_DIFFERS_FROM_CANONICAL"
  | "LEGACY_REVENUE_DIFFERS_FROM_CANONICAL";

export type DemandMismatchEvidenceRow = {
  category: DemandMismatchCategory;
  externalId: string;
  orderNo: string;
  orderedAt: string;
  status: string;
  optionId: string | null;
  productId: string | null;
  mallProductKey: string | null;
  rawOptionBarcode: string | null;
  rawPartnerCode: string | null;
  rawMallOrderCount: string | null;
  rawQuantity: string | null;
  normalizedQuantity: number;
  normalizedUnitPrice: number;
  normalizedPaidAmount: number;
  canonicalState: "VALID" | "TOMBSTONE" | "UNMAPPED" | "IGNORED";
  canonicalBarcode: string | null;
  canonicalUnits: number;
  canonicalRevenue: number;
  legacyState: "VALID" | "UNMAPPED" | "IGNORED";
  legacyBarcode: string | null;
  legacyUnits: number;
  legacyRevenue: number;
  unitDeltaLegacyMinusCanonical: number;
  revenueDeltaLegacyMinusCanonical: number;
};

export type DemandMismatchEvidenceChunk = {
  range: ShoplingDateRange;
  fetchedRows: number;
  candidateRows: number;
  evidenceRows: number;
  truncatedEvidenceRows: number;
  evidence: DemandMismatchEvidenceRow[];
  categoryCounts: Record<DemandMismatchCategory, number>;
};

export type DemandMismatchEvidenceSummary = {
  generatedAt: string;
  fetchedRows: number;
  candidateRows: number;
  evidenceRows: number;
  truncatedEvidenceRows: number;
  affectedBarcodes: string[];
  categoryCounts: Record<DemandMismatchCategory, number>;
  categoryUnitDelta: Record<DemandMismatchCategory, number>;
  categoryRevenueDelta: Record<DemandMismatchCategory, number>;
  topEvidence: DemandMismatchEvidenceRow[];
  evidenceFingerprint: string;
};

type TargetIndex = {
  barcodes: Set<string>;
  optionIds: Set<string>;
  goodsKeys: Set<string>;
};

const CATEGORIES: DemandMismatchCategory[] = [
  "LEGACY_ACCEPTS_CANONICAL_IGNORES",
  "LEGACY_ACCEPTS_CANONICAL_UNMAPPED",
  "CANONICAL_ONLY_LEGACY_IGNORES",
  "CANONICAL_ONLY_LEGACY_UNMAPPED",
  "LEGACY_SKU_DIFFERS_FROM_CANONICAL",
  "LEGACY_QTY_DIFFERS_FROM_CANONICAL",
  "LEGACY_REVENUE_DIFFERS_FROM_CANONICAL",
];

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function rawValue(row: ShoplingRawRow, keys: string[]) {
  for (const key of keys) {
    const direct = row[key];
    if (direct !== undefined && direct !== null && direct !== "") return text(direct);
    const match = Object.keys(row).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase(),
    );
    if (match && row[match] !== undefined && row[match] !== null && row[match] !== "") {
      return text(row[match]);
    }
  }
  return "";
}

function managedBarcode(value: unknown) {
  const barcode = normalizeShoplingBarcode(value);
  return MANAGED_BARCODE.test(barcode) ? barcode : "";
}

function emptyCategoryCounts() {
  return Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as Record<
    DemandMismatchCategory,
    number
  >;
}

function buildTargetIndex(
  planning: ProductPlanningSnapshot,
  targetBarcodes: string[],
): TargetIndex {
  const barcodes = new Set(targetBarcodes.map(managedBarcode).filter(Boolean));
  const optionIds = new Set<string>();
  const goodsKeys = new Set<string>();
  for (const product of planning.products ?? []) {
    const barcode = managedBarcode(product.barcode);
    if (!barcodes.has(barcode)) continue;
    for (const listing of product.listings ?? []) {
      const optionId = text(listing.optionId);
      const goodsKey = text(listing.goodsKey);
      if (optionId) optionIds.add(optionId);
      if (goodsKey) goodsKeys.add(goodsKey);
    }
  }
  return { barcodes, optionIds, goodsKeys };
}

function rawOptionBarcode(raw: ShoplingRawRow) {
  return managedBarcode(rawValue(raw, ["optBarcode", "opt_barcode", "barcode"]));
}

function rawPartnerCode(raw: ShoplingRawRow) {
  return managedBarcode(
    rawValue(raw, [
      "ptn_goods_cd",
      "buying_cd",
      "mall_ptn_goods_cd",
      "mall_opt_cd",
    ]),
  );
}

function candidateRow(raw: ShoplingRawRow, targets: TargetIndex) {
  const order = normalizeShoplingOrder(raw);
  const optionBarcode = rawOptionBarcode(raw) || managedBarcode(order.barcode);
  const partnerCode = rawPartnerCode(raw);
  if (optionBarcode && targets.barcodes.has(optionBarcode)) return true;
  if (partnerCode && targets.barcodes.has(partnerCode)) return true;
  if (order.optionId && targets.optionIds.has(text(order.optionId))) return true;
  for (const key of [text(order.productId), text(order.mallProductKey)]) {
    if (key && targets.goodsKeys.has(key)) return true;
  }
  return false;
}

function canonicalContribution(
  event: ProductMasterSalesEventRow | undefined,
  unmappedRows: number,
) {
  if (event) {
    return {
      state: event.validSale ? ("VALID" as const) : ("TOMBSTONE" as const),
      barcode: event.barcode || null,
      units: event.validSale ? event.quantity : 0,
      revenue: event.validSale ? event.revenue : 0,
    };
  }
  return {
    state: unmappedRows ? ("UNMAPPED" as const) : ("IGNORED" as const),
    barcode: null,
    units: 0,
    revenue: 0,
  };
}

function legacyContribution(
  product: ShoplingOrderProductAggregate | undefined,
  acceptedRows: number,
  unmappedRows: number,
) {
  if (acceptedRows > 0 && product) {
    return {
      state: "VALID" as const,
      barcode: product.barcode || null,
      units: product.units.reduce((sum, value) => sum + Math.round(Number(value) || 0), 0),
      revenue: product.revenue.reduce((sum, value) => sum + Math.round(Number(value) || 0), 0),
    };
  }
  return {
    state: unmappedRows ? ("UNMAPPED" as const) : ("IGNORED" as const),
    barcode: null,
    units: 0,
    revenue: 0,
  };
}

function mismatchCategory(
  canonical: ReturnType<typeof canonicalContribution>,
  legacy: ReturnType<typeof legacyContribution>,
): DemandMismatchCategory | null {
  const canonicalValid = canonical.state === "VALID";
  const legacyValid = legacy.state === "VALID";
  if (!canonicalValid && legacyValid) {
    return canonical.state === "UNMAPPED"
      ? "LEGACY_ACCEPTS_CANONICAL_UNMAPPED"
      : "LEGACY_ACCEPTS_CANONICAL_IGNORES";
  }
  if (canonicalValid && !legacyValid) {
    return legacy.state === "UNMAPPED"
      ? "CANONICAL_ONLY_LEGACY_UNMAPPED"
      : "CANONICAL_ONLY_LEGACY_IGNORES";
  }
  if (!canonicalValid || !legacyValid) return null;
  if (canonical.barcode !== legacy.barcode) {
    return "LEGACY_SKU_DIFFERS_FROM_CANONICAL";
  }
  if (canonical.units !== legacy.units) {
    return "LEGACY_QTY_DIFFERS_FROM_CANONICAL";
  }
  if (canonical.revenue !== legacy.revenue) {
    return "LEGACY_REVENUE_DIFFERS_FROM_CANONICAL";
  }
  return null;
}

function evidenceImpact(row: DemandMismatchEvidenceRow) {
  return (
    Math.abs(row.unitDeltaLegacyMinusCanonical) * 1_000_000_000 +
    Math.abs(row.revenueDeltaLegacyMinusCanonical)
  );
}

export function compileDemandMismatchEvidenceChunk(
  rows: ShoplingRawRow[],
  planning: ProductPlanningSnapshot,
  analysisAsOf: string,
  range: ShoplingDateRange,
  targetBarcodes: string[],
): DemandMismatchEvidenceChunk {
  const targets = buildTargetIndex(planning, targetBarcodes);
  const evidence: DemandMismatchEvidenceRow[] = [];
  const categoryCounts = emptyCategoryCounts();
  let candidateRows = 0;
  let truncatedEvidenceRows = 0;

  for (const raw of rows) {
    if (!candidateRow(raw, targets)) continue;
    candidateRows += 1;
    const order = normalizeShoplingOrder(raw);
    const canonicalChunk = aggregateProductMasterShoplingSalesEventChunk(
      [raw],
      planning,
      range,
      analysisAsOf,
    );
    const legacyChunk = aggregateShoplingOrderChunk(
      [raw],
      planning,
      analysisAsOf,
      range,
    );
    const canonical = canonicalContribution(
      canonicalChunk.events[0],
      canonicalChunk.unmappedRows,
    );
    const legacy = legacyContribution(
      legacyChunk.products[0],
      legacyChunk.acceptedRows,
      legacyChunk.unmappedRows,
    );
    const involvesTarget =
      (canonical.barcode ? targets.barcodes.has(canonical.barcode) : false) ||
      (legacy.barcode ? targets.barcodes.has(legacy.barcode) : false);
    if (!involvesTarget) continue;
    const category = mismatchCategory(canonical, legacy);
    if (!category) continue;
    categoryCounts[category] += 1;
    if (evidence.length >= MAX_EVIDENCE_PER_CHUNK) {
      truncatedEvidenceRows += 1;
      continue;
    }
    evidence.push({
      category,
      externalId: order.id,
      orderNo: order.orderNo,
      orderedAt: order.orderedAt,
      status: order.status,
      optionId: order.optionId || null,
      productId: order.productId,
      mallProductKey: order.mallProductKey,
      rawOptionBarcode: rawOptionBarcode(raw) || null,
      rawPartnerCode: rawPartnerCode(raw) || null,
      rawMallOrderCount: rawValue(raw, ["mall_ord_cnt"]) || null,
      rawQuantity: rawValue(raw, ["quantity"]) || null,
      normalizedQuantity: Number(order.quantity) || 0,
      normalizedUnitPrice: Number(order.unitPrice) || 0,
      normalizedPaidAmount: Number(order.paidAmount) || 0,
      canonicalState: canonical.state,
      canonicalBarcode: canonical.barcode,
      canonicalUnits: canonical.units,
      canonicalRevenue: canonical.revenue,
      legacyState: legacy.state,
      legacyBarcode: legacy.barcode,
      legacyUnits: legacy.units,
      legacyRevenue: legacy.revenue,
      unitDeltaLegacyMinusCanonical: legacy.units - canonical.units,
      revenueDeltaLegacyMinusCanonical: legacy.revenue - canonical.revenue,
    });
  }

  evidence.sort((left, right) => evidenceImpact(right) - evidenceImpact(left));
  return {
    range,
    fetchedRows: rows.length,
    candidateRows,
    evidenceRows: evidence.length + truncatedEvidenceRows,
    truncatedEvidenceRows,
    evidence,
    categoryCounts,
  };
}

export function combineDemandMismatchEvidenceChunks(
  chunks: DemandMismatchEvidenceChunk[],
): DemandMismatchEvidenceSummary {
  const categoryCounts = emptyCategoryCounts();
  const categoryUnitDelta = emptyCategoryCounts();
  const categoryRevenueDelta = emptyCategoryCounts();
  const allEvidence: DemandMismatchEvidenceRow[] = [];
  const affected = new Set<string>();
  let fetchedRows = 0;
  let candidateRows = 0;
  let evidenceRows = 0;
  let truncatedEvidenceRows = 0;

  for (const chunk of chunks) {
    fetchedRows += chunk.fetchedRows;
    candidateRows += chunk.candidateRows;
    evidenceRows += chunk.evidenceRows;
    truncatedEvidenceRows += chunk.truncatedEvidenceRows;
    for (const category of CATEGORIES) {
      categoryCounts[category] += chunk.categoryCounts[category] || 0;
    }
    for (const row of chunk.evidence) {
      allEvidence.push(row);
      categoryUnitDelta[row.category] += row.unitDeltaLegacyMinusCanonical;
      categoryRevenueDelta[row.category] += row.revenueDeltaLegacyMinusCanonical;
      if (row.canonicalBarcode) affected.add(row.canonicalBarcode);
      if (row.legacyBarcode) affected.add(row.legacyBarcode);
    }
  }

  allEvidence.sort((left, right) => evidenceImpact(right) - evidenceImpact(left));
  const topEvidence = allEvidence.slice(0, 100);
  const normalized = {
    fetchedRows,
    candidateRows,
    evidenceRows,
    truncatedEvidenceRows,
    affectedBarcodes: [...affected].sort(),
    categoryCounts,
    categoryUnitDelta,
    categoryRevenueDelta,
    topEvidence,
  };
  return {
    generatedAt: new Date().toISOString(),
    ...normalized,
    evidenceFingerprint: `sha256:${createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex")}`,
  };
}
