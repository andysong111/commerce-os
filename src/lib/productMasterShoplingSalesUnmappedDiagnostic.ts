import {
  PRODUCT_MASTER_SHOPLING_SALES_CHUNK,
  PRODUCT_MASTER_SHOPLING_SALES_REQUEST,
} from "@/lib/productMasterShoplingSalesBackfill";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const MANAGED_BARCODE = /^[A-Z]{3}\d+-\d+$/;
const MAX_OPERATION_ROWS = 500;
const MAX_SAFE_SAMPLES = 5_000;
const MAX_CANDIDATES_PER_SAMPLE = 10;

export type ShoplingSalesUnmappedCategory =
  | "CURRENT_MANAGED_CODE_UNRESOLVED"
  | "CURRENT_OPTION_ID_UNRESOLVED"
  | "CURRENT_GOODS_KEY_UNRESOLVED"
  | "OUTSIDE_CURRENT_PRODUCT_MASTER"
  | "NO_CURRENT_IDENTITY"
  | "MISSING_IDENTIFIERS";

export type ShoplingSalesUnmappedCandidate = {
  skuId: string;
  barcode: string;
  productName: string;
  optionName: string | null;
  goodsKey: string | null;
  optionId: string | null;
  unitsPerOrder: number;
};

export type ShoplingSalesUnmappedSafeSample = {
  category: ShoplingSalesUnmappedCategory;
  orderedAt: string | null;
  optionId: string | null;
  productId: string | null;
  mallProductKey: string | null;
  managedCode: string | null;
  status: string | null;
  currentCandidates: ShoplingSalesUnmappedCandidate[];
};

export type ShoplingSalesUnmappedDiagnostic = {
  requestId: string | null;
  generatedAt: string;
  planningFingerprint: string | null;
  completedChunkRows: number;
  fetchedRows: number;
  acceptedRows: number;
  totalUnmappedRows: number;
  sampledUnmappedRows: number;
  sampleCoverage: number;
  truncatedChunkCount: number;
  storedSamplesExhausted: boolean;
  categories: Array<{
    category: ShoplingSalesUnmappedCategory;
    sampleCount: number;
    shareOfSamples: number;
    risk: "BLOCKER" | "REVIEW";
    meaning: string;
  }>;
  safeSamples: ShoplingSalesUnmappedSafeSample[];
  sourceReadsPerformed: false;
  businessWritesPerformed: false;
};

type OperationRow = {
  correlation_id?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
};

type RawSample = {
  orderedAt: string | null;
  optionId: string | null;
  productId: string | null;
  mallProductKey: string | null;
  managedCode: string | null;
  status: string | null;
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

function nullable(value: unknown) {
  const normalized = text(value);
  return normalized || null;
}

function barcode(value: unknown) {
  const normalized = text(value).toUpperCase().replace(/\s+/g, "");
  return MANAGED_BARCODE.test(normalized) ? normalized : "";
}

function sampleFrom(value: unknown): RawSample {
  const row = object(value);
  return {
    orderedAt: nullable(row.orderedAt),
    optionId: nullable(row.optionId),
    productId: nullable(row.productId),
    mallProductKey: nullable(row.mallProductKey),
    managedCode: nullable(row.managedCode),
    status: nullable(row.status),
  };
}

function categoryMeaning(category: ShoplingSalesUnmappedCategory) {
  switch (category) {
    case "CURRENT_MANAGED_CODE_UNRESOLVED":
      return "주문에 현재 상품마스터 위치코드가 있는데도 연결되지 않았습니다. 옵션별 판매환산 또는 listing identity 충돌 가능성이 있어 우선 해결해야 합니다.";
    case "CURRENT_OPTION_ID_UNRESOLVED":
      return "현재 Product Master listing에 존재하는 Shopling 옵션 ID인데 판매원장 엔진이 연결하지 못했습니다. 현재 SKU 판매 누락 가능성이 높습니다.";
    case "CURRENT_GOODS_KEY_UNRESOLVED":
      return "현재 Product Master listing의 goods_key와 관련된 주문이지만 옵션 단위로 안전하게 결정되지 않았습니다. 현재 goods_key 아래 후보 SKU를 함께 표시합니다.";
    case "OUTSIDE_CURRENT_PRODUCT_MASTER":
      return "위치코드 형식은 맞지만 현재 Product Master 활성 SKU에는 없는 코드입니다. 과거/폐기 SKU인지 확인 후 현재 SKU 판매에서 제외할 수 있습니다.";
    case "NO_CURRENT_IDENTITY":
      return "Shopling 식별자는 있으나 현재 Product Master의 위치코드·옵션 ID·goods_key 어느 것과도 연결되지 않습니다. 과거/외부 상품 가능성이 있습니다.";
    case "MISSING_IDENTIFIERS":
      return "주문행에 현재 SKU를 판별할 위치코드·옵션 ID·상품 식별자가 충분하지 않습니다. 자동 제외할 수 없습니다.";
  }
}

function categoryRisk(category: ShoplingSalesUnmappedCategory) {
  return [
    "CURRENT_MANAGED_CODE_UNRESOLVED",
    "CURRENT_OPTION_ID_UNRESOLVED",
    "CURRENT_GOODS_KEY_UNRESOLVED",
    "MISSING_IDENTIFIERS",
  ].includes(category)
    ? ("BLOCKER" as const)
    : ("REVIEW" as const);
}

export async function loadProductMasterShoplingSalesUnmappedDiagnostic(): Promise<ShoplingSalesUnmappedDiagnostic> {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");

  const requestQuery = await admin
    .from("commerce_operation_runs")
    .select("correlation_id,input_snapshot,started_at")
    .eq("operation_type", PRODUCT_MASTER_SHOPLING_SALES_REQUEST)
    .order("started_at", { ascending: false })
    .limit(1);
  if (requestQuery.error) throw new Error(requestQuery.error.message);
  const requestRows = (Array.isArray(requestQuery.data)
    ? requestQuery.data
    : []) as OperationRow[];
  const latest = requestRows[0];
  const requestInput = object(latest?.input_snapshot);
  const requestId = nullable(requestInput.requestId);
  const correlationId = text(latest?.correlation_id);

  if (!requestId || !correlationId) {
    return {
      requestId: null,
      generatedAt: new Date().toISOString(),
      planningFingerprint: null,
      completedChunkRows: 0,
      fetchedRows: 0,
      acceptedRows: 0,
      totalUnmappedRows: 0,
      sampledUnmappedRows: 0,
      sampleCoverage: 0,
      truncatedChunkCount: 0,
      storedSamplesExhausted: true,
      categories: [],
      safeSamples: [],
      sourceReadsPerformed: false,
      businessWritesPerformed: false,
    };
  }

  const chunksQuery = await admin
    .from("commerce_operation_runs")
    .select("result_snapshot,started_at")
    .eq("operation_type", PRODUCT_MASTER_SHOPLING_SALES_CHUNK)
    .eq("correlation_id", correlationId)
    .order("started_at", { ascending: true })
    .limit(MAX_OPERATION_ROWS);
  if (chunksQuery.error) throw new Error(chunksQuery.error.message);
  const chunks = (Array.isArray(chunksQuery.data)
    ? chunksQuery.data
    : []) as OperationRow[];

  const rawSamples: RawSample[] = [];
  let fetchedRows = 0;
  let acceptedRows = 0;
  let totalUnmappedRows = 0;
  let truncatedChunkCount = 0;
  for (const chunk of chunks) {
    const result = object(chunk.result_snapshot);
    const chunkUnmappedRows = integer(result.unmappedRows);
    const chunkSamples = Array.isArray(result.unmappedSamples)
      ? result.unmappedSamples
      : [];
    fetchedRows += integer(result.fetchedRows);
    acceptedRows += integer(result.acceptedRows);
    totalUnmappedRows += chunkUnmappedRows;
    if (chunkUnmappedRows > chunkSamples.length) truncatedChunkCount += 1;
    for (const sample of chunkSamples) {
      if (rawSamples.length >= MAX_SAFE_SAMPLES) break;
      rawSamples.push(sampleFrom(sample));
    }
  }

  const planning = await loadProductPlanningSnapshot();
  const currentBarcodes = new Set<string>();
  const currentOptionIds = new Set<string>();
  const currentGoodsKeys = new Set<string>();
  const candidatesByBarcode = new Map<string, ShoplingSalesUnmappedCandidate[]>();
  const candidatesByOptionId = new Map<string, ShoplingSalesUnmappedCandidate[]>();
  const candidatesByGoodsKey = new Map<string, ShoplingSalesUnmappedCandidate[]>();

  function addCandidate(
    target: Map<string, ShoplingSalesUnmappedCandidate[]>,
    key: string,
    candidate: ShoplingSalesUnmappedCandidate,
  ) {
    if (!key) return;
    const existing = target.get(key) ?? [];
    const identity = `${candidate.skuId}\u0000${candidate.barcode}\u0000${candidate.optionId ?? ""}\u0000${candidate.goodsKey ?? ""}\u0000${candidate.unitsPerOrder}`;
    if (
      existing.some(
        (row) =>
          `${row.skuId}\u0000${row.barcode}\u0000${row.optionId ?? ""}\u0000${row.goodsKey ?? ""}\u0000${row.unitsPerOrder}` === identity,
      )
    ) {
      return;
    }
    target.set(key, [...existing, candidate].slice(0, MAX_CANDIDATES_PER_SAMPLE));
  }

  for (const product of planning.products ?? []) {
    if (product.skuActive === false) continue;
    const currentBarcode = barcode(product.barcode);
    if (currentBarcode) currentBarcodes.add(currentBarcode);
    for (const listing of product.listings ?? []) {
      if (listing.active === false) continue;
      const optionId = text(listing.optionId);
      const goodsKey = text(listing.goodsKey);
      const candidate: ShoplingSalesUnmappedCandidate = {
        skuId: text(product.skuId),
        barcode: currentBarcode || text(product.barcode),
        productName: text(product.productName),
        optionName: nullable(product.optionName),
        goodsKey: goodsKey || null,
        optionId: optionId || null,
        unitsPerOrder: Math.max(1, integer(listing.unitsPerOrder) || 1),
      };
      if (optionId) {
        currentOptionIds.add(optionId);
        addCandidate(candidatesByOptionId, optionId, candidate);
      }
      if (goodsKey) {
        currentGoodsKeys.add(goodsKey);
        addCandidate(candidatesByGoodsKey, goodsKey, candidate);
      }
      if (currentBarcode) addCandidate(candidatesByBarcode, currentBarcode, candidate);
    }
  }

  function classify(sample: RawSample): ShoplingSalesUnmappedCategory {
    const managedCode = barcode(sample.managedCode);
    if (managedCode && currentBarcodes.has(managedCode)) {
      return "CURRENT_MANAGED_CODE_UNRESOLVED";
    }
    if (sample.optionId && currentOptionIds.has(sample.optionId)) {
      return "CURRENT_OPTION_ID_UNRESOLVED";
    }
    if (
      (sample.productId && currentGoodsKeys.has(sample.productId)) ||
      (sample.mallProductKey && currentGoodsKeys.has(sample.mallProductKey))
    ) {
      return "CURRENT_GOODS_KEY_UNRESOLVED";
    }
    if (managedCode) return "OUTSIDE_CURRENT_PRODUCT_MASTER";
    if (sample.optionId || sample.productId || sample.mallProductKey) {
      return "NO_CURRENT_IDENTITY";
    }
    return "MISSING_IDENTIFIERS";
  }

  function currentCandidates(sample: RawSample) {
    const managedCode = barcode(sample.managedCode);
    const merged: ShoplingSalesUnmappedCandidate[] = [];
    const seen = new Set<string>();
    const lists = [
      managedCode ? candidatesByBarcode.get(managedCode) ?? [] : [],
      sample.optionId ? candidatesByOptionId.get(sample.optionId) ?? [] : [],
      sample.productId ? candidatesByGoodsKey.get(sample.productId) ?? [] : [],
      sample.mallProductKey
        ? candidatesByGoodsKey.get(sample.mallProductKey) ?? []
        : [],
    ];
    for (const list of lists) {
      for (const candidate of list) {
        const key = `${candidate.skuId}\u0000${candidate.barcode}\u0000${candidate.optionId ?? ""}\u0000${candidate.goodsKey ?? ""}\u0000${candidate.unitsPerOrder}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(candidate);
        if (merged.length >= MAX_CANDIDATES_PER_SAMPLE) return merged;
      }
    }
    return merged;
  }

  const safeSamples = rawSamples.map((sample) => ({
    category: classify(sample),
    ...sample,
    currentCandidates: currentCandidates(sample),
  }));
  const categoryCounts = new Map<ShoplingSalesUnmappedCategory, number>();
  for (const sample of safeSamples) {
    categoryCounts.set(
      sample.category,
      (categoryCounts.get(sample.category) ?? 0) + 1,
    );
  }
  const categories = [...categoryCounts.entries()]
    .map(([category, sampleCount]) => ({
      category,
      sampleCount,
      shareOfSamples: safeSamples.length
        ? Math.round((sampleCount / safeSamples.length) * 10_000) / 100
        : 0,
      risk: categoryRisk(category),
      meaning: categoryMeaning(category),
    }))
    .sort(
      (left, right) =>
        (left.risk === right.risk ? 0 : left.risk === "BLOCKER" ? -1 : 1) ||
        right.sampleCount - left.sampleCount ||
        left.category.localeCompare(right.category),
    );

  return {
    requestId,
    generatedAt: new Date().toISOString(),
    planningFingerprint: text(planning.contentFingerprint) || null,
    completedChunkRows: chunks.length,
    fetchedRows,
    acceptedRows,
    totalUnmappedRows,
    sampledUnmappedRows: safeSamples.length,
    sampleCoverage: totalUnmappedRows
      ? Math.min(
          100,
          Math.round((safeSamples.length / totalUnmappedRows) * 10_000) / 100,
        )
      : 100,
    truncatedChunkCount,
    storedSamplesExhausted:
      rawSamples.length < MAX_SAFE_SAMPLES && truncatedChunkCount === 0,
    categories,
    safeSamples,
    sourceReadsPerformed: false,
    businessWritesPerformed: false,
  };
}
