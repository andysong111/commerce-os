import {
  PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_CHUNK,
  PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_REQUEST,
} from "@/lib/productMasterShoplingDiagnostic";
import type { DiagnosticShoplingOption } from "@/lib/productMasterShoplingDiagnosticEngine";
import { loadProductMasterShoplingSalesUnmappedDiagnostic } from "@/lib/productMasterShoplingSalesUnmappedDiagnostic";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const MAX_OPERATION_ROWS = 500;
const MAX_EVIDENCE_OPTIONS = 50_000;
const MAX_MATCHES_PER_SAMPLE = 12;

export type ShoplingSalesCatalogEvidenceClass =
  | "CATALOG_EXACT_OPTION_CURRENT_BARCODE_SAFE_UNITS"
  | "CATALOG_EXACT_OPTION_CURRENT_BARCODE_AMBIGUOUS_UNITS"
  | "CATALOG_EXACT_OPTION_LEGACY_BARCODE"
  | "CATALOG_OPTION_ID_AMBIGUOUS"
  | "CATALOG_GOODS_KEY_ONLY"
  | "NO_CATALOG_EVIDENCE";

export type ShoplingSalesCatalogEvidenceMatch = {
  goodsKey: string;
  optionId: string;
  barcode: string;
  productName: string;
  optionName: string;
  isActive: boolean;
  currentSkuId: string | null;
  currentBarcode: boolean;
  uniqueCurrentUnitsPerOrder: number | null;
};

export type ShoplingSalesCatalogEvidenceSample = {
  order: {
    orderedAt: string | null;
    optionId: string | null;
    productId: string | null;
    mallProductKey: string | null;
    managedCode: string | null;
    status: string | null;
  };
  priorCategory: string;
  classification: ShoplingSalesCatalogEvidenceClass;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  autoResolveCandidate: boolean;
  reason: string;
  matches: ShoplingSalesCatalogEvidenceMatch[];
};

export type ShoplingSalesCatalogEvidenceReport = {
  salesRequestId: string | null;
  catalogRequestId: string | null;
  generatedAt: string;
  catalogChunkCount: number;
  catalogOptionCount: number;
  unmappedStoredSampleCount: number;
  classifications: Array<{
    classification: ShoplingSalesCatalogEvidenceClass;
    count: number;
    share: number;
    autoResolveCandidate: boolean;
  }>;
  highConfidenceAutoResolveSamples: number;
  samples: ShoplingSalesCatalogEvidenceSample[];
  sourceReadsPerformed: false;
  businessWritesPerformed: false;
};

type OperationRow = {
  correlation_id?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
};

type CurrentSku = {
  skuId: string;
  barcode: string;
  units: Set<number>;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function normalizeBarcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function parseCatalogOption(value: unknown): DiagnosticShoplingOption | null {
  const row = object(value);
  const goodsKey = text(row.goodsKey);
  const optionId = text(row.optionId);
  const barcode = normalizeBarcode(row.barcode);
  if (!goodsKey && !optionId && !barcode) return null;
  return {
    goodsKey,
    optionId,
    barcode,
    partnerOptionCode: text(row.partnerOptionCode),
    productName: text(row.productName),
    optionName: text(row.optionName),
    isActive: row.isActive !== false,
  };
}

function addIndex(
  map: Map<string, DiagnosticShoplingOption[]>,
  key: string,
  option: DiagnosticShoplingOption,
) {
  if (!key) return;
  const list = map.get(key) ?? [];
  const identity = `${option.goodsKey}\u0000${option.optionId}\u0000${option.barcode}\u0000${option.optionName}`;
  if (
    list.some(
      (row) =>
        `${row.goodsKey}\u0000${row.optionId}\u0000${row.barcode}\u0000${row.optionName}` ===
        identity,
    )
  ) {
    return;
  }
  map.set(key, [...list, option]);
}

function evidenceClass(input: {
  exact: DiagnosticShoplingOption[];
  goodsKeyMatches: DiagnosticShoplingOption[];
  currentByBarcode: Map<string, CurrentSku>;
}): {
  classification: ShoplingSalesCatalogEvidenceClass;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  autoResolveCandidate: boolean;
  reason: string;
} {
  if (input.exact.length) {
    const barcodes = new Set(
      input.exact.map((row) => normalizeBarcode(row.barcode)).filter(Boolean),
    );
    if (barcodes.size !== 1) {
      return {
        classification: "CATALOG_OPTION_ID_AMBIGUOUS",
        confidence: "LOW",
        autoResolveCandidate: false,
        reason:
          "같은 과거 Shopling optionId가 서로 다른 위치코드 증거를 가져 자동 연결할 수 없습니다.",
      };
    }
    const historicalBarcode = [...barcodes][0] ?? "";
    const current = input.currentByBarcode.get(historicalBarcode);
    if (!current) {
      return {
        classification: "CATALOG_EXACT_OPTION_LEGACY_BARCODE",
        confidence: "MEDIUM",
        autoResolveCandidate: false,
        reason:
          "과거 catalog에서 optionId를 정확히 찾았지만 당시 위치코드가 현재 활성 Product Master 위치코드가 아닙니다.",
      };
    }
    if (current.units.size !== 1) {
      return {
        classification:
          "CATALOG_EXACT_OPTION_CURRENT_BARCODE_AMBIGUOUS_UNITS",
        confidence: "MEDIUM",
        autoResolveCandidate: false,
        reason:
          "과거 optionId는 현재 위치코드까지 정확히 이어지지만 현재 listing의 주문당 재고수량이 하나로 결정되지 않습니다.",
      };
    }
    return {
      classification: "CATALOG_EXACT_OPTION_CURRENT_BARCODE_SAFE_UNITS",
      confidence: "HIGH",
      autoResolveCandidate: true,
      reason:
        "과거 optionId가 한 위치코드로만 이어지고 그 위치코드의 현재 주문당 재고수량도 하나로 결정됩니다.",
    };
  }
  if (input.goodsKeyMatches.length) {
    return {
      classification: "CATALOG_GOODS_KEY_ONLY",
      confidence: "LOW",
      autoResolveCandidate: false,
      reason:
        "같은 goods_key의 과거 catalog 증거는 있지만 주문 optionId를 정확히 특정하지 못했습니다.",
    };
  }
  return {
    classification: "NO_CATALOG_EVIDENCE",
    confidence: "LOW",
    autoResolveCandidate: false,
    reason:
      "현재 보존된 24개월 Shopling 상품 catalog 증거에서 주문 식별자와 교집합을 찾지 못했습니다.",
  };
}

export async function loadProductMasterShoplingSalesCatalogEvidence(): Promise<ShoplingSalesCatalogEvidenceReport> {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");

  const [unmapped, planning, requestQuery] = await Promise.all([
    loadProductMasterShoplingSalesUnmappedDiagnostic(),
    loadProductPlanningSnapshot(),
    admin
      .from("commerce_operation_runs")
      .select("correlation_id,input_snapshot")
      .eq("operation_type", PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_REQUEST)
      .order("started_at", { ascending: false })
      .limit(1),
  ]);
  if (requestQuery.error) throw new Error(requestQuery.error.message);
  const requestRows = (Array.isArray(requestQuery.data)
    ? requestQuery.data
    : []) as OperationRow[];
  const request = requestRows[0];
  const catalogCorrelationId = text(request?.correlation_id);
  const catalogRequestId = text(object(request?.input_snapshot).requestId) || null;

  const currentByBarcode = new Map<string, CurrentSku>();
  for (const product of planning.products ?? []) {
    if (product.skuActive === false) continue;
    const barcode = normalizeBarcode(product.barcode);
    if (!barcode) continue;
    const units = new Set<number>();
    for (const listing of product.listings ?? []) {
      if (listing.active === false) continue;
      units.add(Math.max(1, integer(listing.unitsPerOrder) || 1));
    }
    currentByBarcode.set(barcode, {
      skuId: text(product.skuId),
      barcode,
      units,
    });
  }

  let catalogChunkCount = 0;
  const catalogOptions: DiagnosticShoplingOption[] = [];
  if (catalogCorrelationId) {
    const chunksQuery = await admin
      .from("commerce_operation_runs")
      .select("result_snapshot")
      .eq("operation_type", PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_CHUNK)
      .eq("correlation_id", catalogCorrelationId)
      .order("started_at", { ascending: true })
      .limit(MAX_OPERATION_ROWS);
    if (chunksQuery.error) throw new Error(chunksQuery.error.message);
    const chunks = (Array.isArray(chunksQuery.data)
      ? chunksQuery.data
      : []) as OperationRow[];
    catalogChunkCount = chunks.length;
    for (const chunk of chunks) {
      const result = object(chunk.result_snapshot);
      if (!Array.isArray(result.options)) continue;
      for (const raw of result.options) {
        if (catalogOptions.length >= MAX_EVIDENCE_OPTIONS) break;
        const parsed = parseCatalogOption(raw);
        if (parsed) catalogOptions.push(parsed);
      }
    }
  }

  const byOptionId = new Map<string, DiagnosticShoplingOption[]>();
  const byGoodsKey = new Map<string, DiagnosticShoplingOption[]>();
  for (const option of catalogOptions) {
    addIndex(byOptionId, option.optionId, option);
    addIndex(byGoodsKey, option.goodsKey, option);
  }

  const samples = unmapped.safeSamples.map((sample) => {
    const optionId = text(sample.optionId);
    const goodsCandidates = [sample.productId, sample.mallProductKey]
      .map(text)
      .filter(Boolean);
    const exact = (byOptionId.get(optionId) ?? []).slice(0, MAX_MATCHES_PER_SAMPLE);
    const goodsKeyMatches: DiagnosticShoplingOption[] = [];
    const seen = new Set<string>();
    for (const key of goodsCandidates) {
      for (const match of byGoodsKey.get(key) ?? []) {
        const identity = `${match.goodsKey}\u0000${match.optionId}\u0000${match.barcode}\u0000${match.optionName}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        goodsKeyMatches.push(match);
        if (goodsKeyMatches.length >= MAX_MATCHES_PER_SAMPLE) break;
      }
      if (goodsKeyMatches.length >= MAX_MATCHES_PER_SAMPLE) break;
    }
    const decision = evidenceClass({ exact, goodsKeyMatches, currentByBarcode });
    const rawMatches = exact.length ? exact : goodsKeyMatches;
    const matches: ShoplingSalesCatalogEvidenceMatch[] = rawMatches.map((match) => {
      const current = currentByBarcode.get(normalizeBarcode(match.barcode));
      return {
        goodsKey: match.goodsKey,
        optionId: match.optionId,
        barcode: match.barcode,
        productName: match.productName,
        optionName: match.optionName,
        isActive: match.isActive,
        currentSkuId: current?.skuId ?? null,
        currentBarcode: Boolean(current),
        uniqueCurrentUnitsPerOrder:
          current?.units.size === 1 ? [...current.units][0] ?? null : null,
      };
    });
    return {
      order: {
        orderedAt: sample.orderedAt,
        optionId: sample.optionId,
        productId: sample.productId,
        mallProductKey: sample.mallProductKey,
        managedCode: sample.managedCode,
        status: sample.status,
      },
      priorCategory: sample.category,
      ...decision,
      matches,
    };
  });

  const counts = new Map<ShoplingSalesCatalogEvidenceClass, number>();
  for (const sample of samples) {
    counts.set(sample.classification, (counts.get(sample.classification) ?? 0) + 1);
  }
  const classifications = [...counts.entries()]
    .map(([classification, count]) => ({
      classification,
      count,
      share: samples.length
        ? Math.round((count / samples.length) * 10_000) / 100
        : 0,
      autoResolveCandidate:
        classification === "CATALOG_EXACT_OPTION_CURRENT_BARCODE_SAFE_UNITS",
    }))
    .sort((left, right) => right.count - left.count);

  return {
    salesRequestId: unmapped.requestId,
    catalogRequestId,
    generatedAt: new Date().toISOString(),
    catalogChunkCount,
    catalogOptionCount: catalogOptions.length,
    unmappedStoredSampleCount: samples.length,
    classifications,
    highConfidenceAutoResolveSamples: samples.filter(
      (sample) => sample.autoResolveCandidate,
    ).length,
    samples,
    sourceReadsPerformed: false,
    businessWritesPerformed: false,
  };
}
