import { createHash } from "node:crypto";
import { calculateNetRequirement } from "@/lib/productDecisionEngine/netRequirement";
import type { SalesOrderGroup } from "@/lib/productDecisionEngine/salesOrder";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import {
  PRODUCT_MASTER_SHOPLING_SALES_CHUNK,
  loadProductMasterShoplingSalesStatus,
} from "@/lib/productMasterShoplingSalesBackfill";
import {
  combineProductMasterShoplingSalesChunks,
  type ProductMasterShoplingSalesChunk,
} from "@/lib/productMasterShoplingSalesBackfillEngine";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadCanonicalPurchaseShadow } from "@/lib/stage8CanonicalPurchaseShadow";
import {
  buildProvisionalDecisionEnvelope,
  type ProvisionalDecisionEnvelopeState,
} from "@/lib/stage8ProvisionalDecisionEnvelope";
import { loadProvisionalInventoryDiagnostics } from "@/lib/stage8ProvisionalInventoryDiagnostics";

const DAY_MS = 86_400_000;

type OperationRow = {
  result_snapshot?: unknown;
  started_at?: unknown;
};

export type StoredMonthlyGapEnvelopeRow = {
  barcode: string;
  modelNo: string;
  productName: string;
  state:
    | "MONTHLY_BAND_READY"
    | "MONTHLY_COVERAGE_MISSING"
    | "MONTHLY_IDENTITY_COVERAGE_UNPROVEN"
    | "PURCHASE_INPUT_MISSING";
  message: string;
  gapStartDate: string;
  gapEndDate: string;
  startMonth: string;
  endMonth: string;
  requiredEvidenceMonthCount: number;
  explicitEvidenceMonthCount: number;
  startMonthQuantity: number;
  interiorFullMonthQuantity: number;
  endMonthQuantity: number;
  gapSalesLowerBound: number;
  gapSalesUpperBound: number;
  canonicalSalesAfterGap: number;
  latestOrderQuantity: number;
  latestResidualLowerBound: number;
  latestResidualUpperBound: number;
  cumulativeResidualCandidate: number;
  diagnosticLowQuantity: number;
  diagnosticHighQuantity: number;
  decisionState: ProvisionalDecisionEnvelopeState;
  lowRecommendedQuantity: number;
  highRecommendedQuantity: number;
  conservativeDraftRecommendedQuantity: number;
  draftSimulationEligible: boolean;
  actualDraftCreationEnabled: false;
  inventoryUseAllowed: false;
  inventoryPromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
};

export type StoredMonthlyGapEnvelope = {
  generatedAt: string;
  state: "READY_READ_ONLY" | "BLOCKED";
  message: string;
  backfillRequestId: string | null;
  backfillState: string;
  backfillCompletedRanges: number;
  backfillTotalRanges: number;
  storedCoverageStart: string | null;
  storedCoverageEnd: string | null;
  storedEvidenceMonthStart: string | null;
  storedEvidenceMonthEnd: string | null;
  canonicalCoverageStart: string | null;
  targetCount: number;
  readyBandCount: number;
  identityCoverageUnprovenCount: number;
  inventorySensitiveCount: number;
  orderDirectionStableCount: number;
  holdDirectionStableCount: number;
  fingerprint: string;
  actualDraftCreationEnabled: false;
  inventoryPromotionAllowed: false;
  purchaseWritesEnabled: false;
  inventoryWritesEnabled: false;
  rows: StoredMonthlyGapEnvelopeRow[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeBarcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
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

function dateMs(value: string) {
  const parsed = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function nextDate(value: string) {
  const parsed = dateMs(value);
  return Number.isFinite(parsed)
    ? new Date(parsed + DAY_MS).toISOString().slice(0, 10)
    : "";
}

function previousDate(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Date(parsed - DAY_MS).toISOString().slice(0, 10)
    : "";
}

function rangesCover(
  startDate: string,
  endDate: string,
  ranges: ProductMasterShoplingSalesChunk["range"][],
) {
  let cursor = startDate;
  const sorted = [...ranges].sort((left, right) =>
    `${left.start}\u0000${left.end}`.localeCompare(`${right.start}\u0000${right.end}`),
  );
  for (const range of sorted) {
    if (range.end < cursor) continue;
    if (range.start > cursor) return false;
    const after = nextDate(range.end);
    if (!after) return false;
    cursor = after;
    if (cursor > endDate) return true;
  }
  return cursor > endDate;
}

function monthSequence(startMonth: string, endMonth: string) {
  if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth)) {
    return [];
  }
  const output: string[] = [];
  let cursor = new Date(`${startMonth}-01T00:00:00.000Z`);
  const end = new Date(`${endMonth}-01T00:00:00.000Z`);
  while (cursor <= end && output.length < 36) {
    output.push(cursor.toISOString().slice(0, 7));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return output;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

async function loadStoredChunks(requestId: string) {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const correlationId = `product-master-shopling-sales:${requestId}`;
  const result = await admin
    .from("commerce_operation_runs")
    .select("result_snapshot,started_at")
    .eq("operation_type", PRODUCT_MASTER_SHOPLING_SALES_CHUNK)
    .eq("correlation_id", correlationId)
    .order("started_at", { ascending: true })
    .limit(500);
  if (result.error) throw new Error(result.error.message);
  return (Array.isArray(result.data) ? result.data : [])
    .map((row) => row as OperationRow)
    .map((row) => object(row.result_snapshot))
    .filter(
      (snapshot) =>
        snapshot.range &&
        typeof snapshot.range === "object" &&
        Array.isArray(snapshot.monthlyRows),
    )
    .map((snapshot) => snapshot as unknown as ProductMasterShoplingSalesChunk);
}

function blockedRow(input: {
  barcode: string;
  modelNo: string;
  productName: string;
  state: Exclude<StoredMonthlyGapEnvelopeRow["state"], "MONTHLY_BAND_READY">;
  message: string;
  gapStartDate: string;
  gapEndDate: string;
  startMonth: string;
  endMonth: string;
  requiredEvidenceMonthCount: number;
  explicitEvidenceMonthCount: number;
  startMonthQuantity: number;
  interiorFullMonthQuantity: number;
  endMonthQuantity: number;
  canonicalSalesAfterGap: number;
  latestOrderQuantity: number;
  cumulativeResidualCandidate: number;
}): StoredMonthlyGapEnvelopeRow {
  return {
    barcode: input.barcode,
    modelNo: input.modelNo,
    productName: input.productName,
    state: input.state,
    message: input.message,
    gapStartDate: input.gapStartDate,
    gapEndDate: input.gapEndDate,
    startMonth: input.startMonth,
    endMonth: input.endMonth,
    requiredEvidenceMonthCount: input.requiredEvidenceMonthCount,
    explicitEvidenceMonthCount: input.explicitEvidenceMonthCount,
    startMonthQuantity: input.startMonthQuantity,
    interiorFullMonthQuantity: input.interiorFullMonthQuantity,
    endMonthQuantity: input.endMonthQuantity,
    gapSalesLowerBound: 0,
    gapSalesUpperBound: 0,
    canonicalSalesAfterGap: input.canonicalSalesAfterGap,
    latestOrderQuantity: input.latestOrderQuantity,
    latestResidualLowerBound: 0,
    latestResidualUpperBound: 0,
    cumulativeResidualCandidate: input.cumulativeResidualCandidate,
    diagnosticLowQuantity: 0,
    diagnosticHighQuantity: 0,
    decisionState: "BLOCKED",
    lowRecommendedQuantity: 0,
    highRecommendedQuantity: 0,
    conservativeDraftRecommendedQuantity: 0,
    draftSimulationEligible: false,
    actualDraftCreationEnabled: false,
    inventoryUseAllowed: false,
    inventoryPromotionAllowed: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
  };
}

export async function loadStoredMonthlyGapEnvelope(): Promise<StoredMonthlyGapEnvelope> {
  const [backfill, diagnostics, purchaseShadow, planning] = await Promise.all([
    loadProductMasterShoplingSalesStatus(),
    loadProvisionalInventoryDiagnostics(),
    loadCanonicalPurchaseShadow(),
    loadProductPlanningSnapshot(),
  ]);
  const requestId = backfill.requestId;
  const backfillComplete =
    backfill.state === "COMPLETED" &&
    Boolean(requestId) &&
    backfill.totalRanges > 0 &&
    backfill.completedRanges === backfill.totalRanges &&
    (backfill.report?.unmappedRows ?? 0) === 0;
  const chunks = backfillComplete && requestId ? await loadStoredChunks(requestId) : [];
  const combined = combineProductMasterShoplingSalesChunks(chunks);
  const storedRanges = chunks.map((chunk) => chunk.range);
  const storedCoverageStart = storedRanges.length
    ? [...storedRanges].sort((a, b) => a.start.localeCompare(b.start))[0]?.start ?? null
    : null;
  const storedCoverageEnd = storedRanges.length
    ? [...storedRanges].sort((a, b) => b.end.localeCompare(a.end))[0]?.end ?? null
    : null;
  const storedEvidenceMonthStart = combined.months[0] ?? null;
  const storedEvidenceMonthEnd = combined.months.at(-1) ?? null;
  const canonicalCoverageStart = diagnostics.canonicalCoverageStartAt;
  const gapEndDate = canonicalCoverageStart ? previousDate(canonicalCoverageStart) : "";
  const monthlyByBarcode = new Map<string, Map<string, number>>();
  for (const row of combined.rows) {
    const key = normalizeBarcode(row.barcode);
    const monthly = monthlyByBarcode.get(key) ?? new Map<string, number>();
    monthly.set(row.month, (monthly.get(row.month) ?? 0) + integer(row.quantity));
    monthlyByBarcode.set(key, monthly);
  }
  const purchaseByBarcode = new Map(
    (purchaseShadow.snapshot?.products ?? []).map(
      (row) => [normalizeBarcode(row.barcode), row] as const,
    ),
  );
  const planningByBarcode = new Map(
    planning.products
      .filter((row) => row.skuActive !== false)
      .map((row) => [normalizeBarcode(row.barcode), row] as const),
  );
  const targets = diagnostics.rows.filter(
    (row) =>
      row.state === "LATEST_COVERAGE_GAP" &&
      row.modelNo &&
      row.latestDeductionStartDate &&
      row.latestOrderQuantity !== null &&
      row.cumulativeResidualCandidate !== null,
  );

  const rows = targets.map((target): StoredMonthlyGapEnvelopeRow => {
    const barcode = normalizeBarcode(target.barcode);
    const modelNo = target.modelNo ?? "";
    const gapStartDate = target.latestDeductionStartDate ?? "";
    const startMonth = gapStartDate.slice(0, 7);
    const endMonth = gapEndDate.slice(0, 7);
    const requiredMonths = monthSequence(startMonth, endMonth);
    const monthMap = monthlyByBarcode.get(barcode) ?? new Map<string, number>();
    const explicitEvidenceMonthCount = requiredMonths.filter((month) =>
      monthMap.has(month),
    ).length;
    const chunkCoverageReady =
      backfillComplete &&
      Boolean(gapStartDate && gapEndDate) &&
      gapStartDate <= gapEndDate &&
      rangesCover(gapStartDate, gapEndDate, storedRanges);
    const identityCoverageReady =
      requiredMonths.length > 0 &&
      requiredMonths.every((month) => monthMap.has(month));
    const startMonthQuantity = integer(monthMap.get(startMonth));
    const endMonthQuantity =
      startMonth === endMonth ? 0 : integer(monthMap.get(endMonth));
    const interiorFullMonthQuantity = [...monthMap.entries()]
      .filter(([month]) => month > startMonth && month < endMonth)
      .reduce((sum, [, quantity]) => sum + integer(quantity), 0);
    const canonicalSalesAfterGap = integer(target.canonical360SalesQuantity);
    const latestOrderQuantity = integer(target.latestOrderQuantity);
    const cumulativeResidualCandidate = integer(target.cumulativeResidualCandidate);
    const common = {
      barcode,
      modelNo,
      productName: target.productName,
      gapStartDate,
      gapEndDate,
      startMonth,
      endMonth,
      requiredEvidenceMonthCount: requiredMonths.length,
      explicitEvidenceMonthCount,
      startMonthQuantity,
      interiorFullMonthQuantity,
      endMonthQuantity,
      canonicalSalesAfterGap,
      latestOrderQuantity,
      cumulativeResidualCandidate,
    };

    if (!chunkCoverageReady) {
      return blockedRow({
        ...common,
        state: "MONTHLY_COVERAGE_MISSING",
        message: "저장된 24개월 chunk 날짜구간이 gap 전체를 연속 커버하지 않아 월판매 증거를 사용하지 않습니다.",
      });
    }
    if (!identityCoverageReady) {
      return blockedRow({
        ...common,
        state: "MONTHLY_IDENTITY_COVERAGE_UNPROVEN",
        message: "날짜 chunk는 존재하지만 이 B-code의 gap 월마다 명시적인 월판매 행이 존재하지 않습니다. 과거 aaa 코드 주문이 당시 B-code로 매핑되지 않아 누락됐을 가능성과 실제 0판매를 구분할 수 없으므로, 행 부재를 0판매로 간주하지 않습니다.",
      });
    }

    const purchase = purchaseByBarcode.get(barcode);
    const profile = planningByBarcode.get(barcode);
    if (!purchase || !profile) {
      return blockedRow({
        ...common,
        state: "PURCHASE_INPUT_MISSING",
        message: "발주 shadow 또는 planning 입력이 없어 월 단위 재고범위를 발주판단에 연결하지 않습니다.",
      });
    }

    const gapSalesLowerBound = interiorFullMonthQuantity;
    const gapSalesUpperBound =
      interiorFullMonthQuantity + startMonthQuantity + endMonthQuantity;
    const latestResidualLowerBound = Math.max(
      0,
      latestOrderQuantity - canonicalSalesAfterGap - gapSalesUpperBound,
    );
    const latestResidualUpperBound = Math.max(
      0,
      latestOrderQuantity - canonicalSalesAfterGap - gapSalesLowerBound,
    );
    const diagnosticLowQuantity = Math.min(
      cumulativeResidualCandidate,
      latestResidualLowerBound,
    );
    const diagnosticHighQuantity = Math.max(
      cumulativeResidualCandidate,
      latestResidualUpperBound,
    );
    const demandTarget = integer(
      purchase.rawRecommendedQty ?? purchase.recommendedQty,
    );
    const originalGroup = salesOrderGroup(purchase.status);
    const openCommitment = integer(purchase.openCommitment);
    const calculate = (inventoryQuantity: number) =>
      calculateNetRequirement({
        demandTarget,
        originalGroup,
        inventoryKnown: true,
        availableQuantity: inventoryQuantity,
        reservedQuantity: 0,
        incomingQuantity: 0,
        ledgerCommitment: openCommitment,
        moq: Math.max(1, integer(profile.moq) || 1),
        cartonQuantity: Math.max(1, integer(profile.cartonQuantity) || 1),
      });
    const low = calculate(diagnosticLowQuantity);
    const high = calculate(diagnosticHighQuantity);
    const envelope = buildProvisionalDecisionEnvelope({
      barcode,
      lowInventoryQuantity: diagnosticLowQuantity,
      highInventoryQuantity: diagnosticHighQuantity,
      lowRecommendedQuantity: low.recommendedQuantity,
      highRecommendedQuantity: high.recommendedQuantity,
      lowPurchaseStatus: low.group,
      highPurchaseStatus: high.group,
      sourceFingerprint: diagnostics.fingerprint,
    });

    return {
      ...common,
      state: "MONTHLY_BAND_READY",
      message: "모든 gap 월에 이 B-code의 명시적 월판매 증거가 존재합니다. 시작월·종료월의 일별 분포는 만들지 않고 두 경계월을 0~월전체로 두며, 사이 완전월만 확정 차감해 보수적인 최신잔여 범위를 계산합니다.",
      gapSalesLowerBound,
      gapSalesUpperBound,
      latestResidualLowerBound,
      latestResidualUpperBound,
      diagnosticLowQuantity,
      diagnosticHighQuantity,
      decisionState: envelope.state,
      lowRecommendedQuantity: low.recommendedQuantity,
      highRecommendedQuantity: high.recommendedQuantity,
      conservativeDraftRecommendedQuantity:
        envelope.conservativeDraftRecommendedQuantity,
      draftSimulationEligible: envelope.draftRecommendationEligible,
      actualDraftCreationEnabled: false,
      inventoryUseAllowed: false,
      inventoryPromotionAllowed: false,
      purchaseWritesEnabled: false,
      inventoryWritesEnabled: false,
    };
  });

  const ready =
    backfillComplete &&
    chunks.length > 0 &&
    diagnostics.state === "READY_READ_ONLY" &&
    Boolean(purchaseShadow.snapshot);
  const stable = rows.map((row) => ({
    barcode: row.barcode,
    state: row.state,
    requiredEvidenceMonthCount: row.requiredEvidenceMonthCount,
    explicitEvidenceMonthCount: row.explicitEvidenceMonthCount,
    gapSalesLowerBound: row.gapSalesLowerBound,
    gapSalesUpperBound: row.gapSalesUpperBound,
    latestResidualLowerBound: row.latestResidualLowerBound,
    latestResidualUpperBound: row.latestResidualUpperBound,
    cumulativeResidualCandidate: row.cumulativeResidualCandidate,
    diagnosticLowQuantity: row.diagnosticLowQuantity,
    diagnosticHighQuantity: row.diagnosticHighQuantity,
    decisionState: row.decisionState,
  }));

  return {
    generatedAt: new Date().toISOString(),
    state: ready ? "READY_READ_ONLY" : "BLOCKED",
    message: ready
      ? "완료된 24개월 월판매 chunk는 날짜 커버리지와 SKU 정체성 커버리지를 구분해서 사용합니다. 날짜 chunk가 있어도 해당 B-code 월행이 없으면 0판매로 가정하지 않고 IDENTITY_COVERAGE_UNPROVEN으로 차단합니다."
      : "완료된 24개월 Shopling 월판매 원장 또는 선행 추정재고 진단이 준비되지 않아 월 단위 gap 보완을 차단합니다.",
    backfillRequestId: requestId,
    backfillState: backfill.state,
    backfillCompletedRanges: backfill.completedRanges,
    backfillTotalRanges: backfill.totalRanges,
    storedCoverageStart,
    storedCoverageEnd,
    storedEvidenceMonthStart,
    storedEvidenceMonthEnd,
    canonicalCoverageStart,
    targetCount: rows.length,
    readyBandCount: rows.filter((row) => row.state === "MONTHLY_BAND_READY").length,
    identityCoverageUnprovenCount: rows.filter(
      (row) => row.state === "MONTHLY_IDENTITY_COVERAGE_UNPROVEN",
    ).length,
    inventorySensitiveCount: rows.filter(
      (row) => row.decisionState === "INVENTORY_SENSITIVE",
    ).length,
    orderDirectionStableCount: rows.filter(
      (row) => row.decisionState === "ORDER_DIRECTION_STABLE",
    ).length,
    holdDirectionStableCount: rows.filter(
      (row) => row.decisionState === "HOLD_DIRECTION_STABLE",
    ).length,
    fingerprint: sha256({
      backfillRequestId: requestId,
      backfillState: backfill.state,
      backfillReport: backfill.report,
      diagnosticFingerprint: diagnostics.fingerprint,
      planningFingerprint: planning.contentFingerprint,
      rows: stable,
    }),
    actualDraftCreationEnabled: false,
    inventoryPromotionAllowed: false,
    purchaseWritesEnabled: false,
    inventoryWritesEnabled: false,
    rows,
  };
}
