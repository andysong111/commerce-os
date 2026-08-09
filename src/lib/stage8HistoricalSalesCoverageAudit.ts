import { createHash } from "node:crypto";
import { legacyOrderSurrogateValidationEvidence } from "@/data/stage8LegacyOrderSurrogateValidationEvidence";
import {
  PRODUCT_MASTER_SHOPLING_SALES_CHUNK,
  loadProductMasterShoplingSalesStatus,
} from "@/lib/productMasterShoplingSalesBackfill";
import { loadProductMasterCanonicalSalesAudit } from "@/lib/productMasterCanonicalSalesAudit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type HistoricalSalesCoverageMonth = {
  month: string;
  quantity: number;
  revenue: number;
  lastSaleAt: string | null;
};

export type HistoricalSalesCoverageRow = {
  barcode: string;
  modelNumber: string;
  productName: string;
  canonicalWindowStart: string;
  canonicalWindowEnd: string;
  canonical360SalesQuantity: number;
  backfillSalesQuantity: number;
  backfillPreCanonicalFullMonthQuantity: number;
  backfillCanonicalStartMonthQuantity: number;
  earliestBackfillMonth: string | null;
  latestBackfillMonth: string | null;
  historicalMonthPresentBeforeCanonicalWindow: boolean;
  months: HistoricalSalesCoverageMonth[];
  inventoryUseAllowed: false;
  operationalEstimateAllowed: false;
};

export type HistoricalSalesCoverageAudit = {
  generatedAt: string;
  state: "READY" | "NO_BACKFILL" | "BLOCKED";
  message: string;
  backfillRequestId: string | null;
  backfillState: string;
  backfillGlobalMonthRange: string | null;
  canonicalAnalysisAsOf: string | null;
  chunkEvidenceCount: number;
  rows: HistoricalSalesCoverageRow[];
  fingerprint: string;
  businessWritesPerformed: false;
  inventoryWritesEnabled: false;
};

type OperationRow = {
  source_event_id?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
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

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function shiftDays(iso: string, days: number) {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed)
    ? new Date(parsed + days * 86_400_000).toISOString()
    : "";
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + integer(value), 0);
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

async function loadBackfillChunks(requestId: string) {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const correlationId = `product-master-shopling-sales:${requestId}`;
  const result = await admin
    .from("commerce_operation_runs")
    .select("source_event_id,input_snapshot,result_snapshot,started_at")
    .eq("operation_type", PRODUCT_MASTER_SHOPLING_SALES_CHUNK)
    .eq("correlation_id", correlationId)
    .order("started_at", { ascending: true })
    .limit(500);
  if (result.error) throw new Error(result.error.message);
  return (Array.isArray(result.data) ? result.data : []) as OperationRow[];
}

function monthlyEvidence(chunks: OperationRow[], targetBarcode: string) {
  const monthly = new Map<string, HistoricalSalesCoverageMonth>();
  for (const chunk of chunks) {
    const snapshot = object(chunk.result_snapshot);
    const rows = Array.isArray(snapshot.monthlyRows) ? snapshot.monthlyRows : [];
    for (const raw of rows) {
      const row = object(raw);
      if (barcode(row.barcode) !== targetBarcode) continue;
      const month = text(row.month);
      if (!/^\d{4}-\d{2}$/.test(month)) continue;
      const current = monthly.get(month) ?? {
        month,
        quantity: 0,
        revenue: 0,
        lastSaleAt: null,
      };
      current.quantity += integer(row.quantity);
      current.revenue += integer(row.revenue);
      const lastSaleAt = text(row.lastSaleAt) || null;
      if (lastSaleAt && (!current.lastSaleAt || lastSaleAt > current.lastSaleAt)) {
        current.lastSaleAt = lastSaleAt;
      }
      monthly.set(month, current);
    }
  }
  return [...monthly.values()].sort((left, right) => left.month.localeCompare(right.month));
}

export async function loadHistoricalSalesCoverageAudit(): Promise<HistoricalSalesCoverageAudit> {
  const [backfill, canonical] = await Promise.all([
    loadProductMasterShoplingSalesStatus(),
    loadProductMasterCanonicalSalesAudit(),
  ]);
  if (!backfill.requestId) {
    return {
      generatedAt: new Date().toISOString(),
      state: "NO_BACKFILL",
      message: "기존 24개월 Shopling 판매원장 요청이 없어 과거 판매 증거를 재사용할 수 없습니다.",
      backfillRequestId: null,
      backfillState: backfill.state,
      backfillGlobalMonthRange: null,
      canonicalAnalysisAsOf: canonical.analysisAsOf,
      chunkEvidenceCount: 0,
      rows: [],
      fingerprint: sha256({ state: "NO_BACKFILL", canonical: canonical.analysisAsOf }),
      businessWritesPerformed: false,
      inventoryWritesEnabled: false,
    };
  }

  const chunks = await loadBackfillChunks(backfill.requestId);
  const canonicalRows = new Map(
    (canonical.snapshot?.rows ?? []).map((row) => [barcode(row.barcode), row] as const),
  );
  const analysisAsOf = canonical.analysisAsOf ?? canonical.snapshot?.analysisAsOf ?? null;
  const canonicalWindowStart = analysisAsOf ? shiftDays(analysisAsOf, -360) : "";
  const canonicalWindowStartMonth = canonicalWindowStart.slice(0, 7);

  const rows = legacyOrderSurrogateValidationEvidence().map(
    (target): HistoricalSalesCoverageRow => {
      const key = barcode(target.barcode);
      const months = monthlyEvidence(chunks, key);
      const canonicalRow = canonicalRows.get(key) ?? null;
      const canonical360SalesQuantity = canonicalRow
        ? sum(canonicalRow.monthlyUnits)
        : 0;
      const backfillSalesQuantity = months.reduce(
        (total, row) => total + row.quantity,
        0,
      );
      const backfillPreCanonicalFullMonthQuantity = months
        .filter((row) => row.month < canonicalWindowStartMonth)
        .reduce((total, row) => total + row.quantity, 0);
      const backfillCanonicalStartMonthQuantity = months
        .filter((row) => row.month === canonicalWindowStartMonth)
        .reduce((total, row) => total + row.quantity, 0);
      return {
        barcode: key,
        modelNumber: target.modelNumber,
        productName: target.productName,
        canonicalWindowStart,
        canonicalWindowEnd: analysisAsOf ?? "",
        canonical360SalesQuantity,
        backfillSalesQuantity,
        backfillPreCanonicalFullMonthQuantity,
        backfillCanonicalStartMonthQuantity,
        earliestBackfillMonth: months[0]?.month ?? null,
        latestBackfillMonth: months.at(-1)?.month ?? null,
        historicalMonthPresentBeforeCanonicalWindow: months.some(
          (row) => row.month < canonicalWindowStartMonth,
        ),
        months,
        inventoryUseAllowed: false,
        operationalEstimateAllowed: false,
      };
    },
  );

  const globalMonths = backfill.report?.months ?? [];
  const ready = canonical.ready && chunks.length > 0;
  return {
    generatedAt: new Date().toISOString(),
    state: ready ? "READY" : "BLOCKED",
    message: ready
      ? "이미 수집된 Shopling 24개월 operation ledger를 다시 읽어 검증 대상 B-code의 Canonical 360일 이전 판매 흔적을 확인했습니다. 네트워크 재수집이나 비즈니스 write는 수행하지 않았습니다."
      : "Canonical 판매원장 또는 기존 24개월 chunk 증거가 준비되지 않아 과거 판매 커버리지 판단을 차단했습니다.",
    backfillRequestId: backfill.requestId,
    backfillState: backfill.state,
    backfillGlobalMonthRange: globalMonths.length
      ? `${globalMonths[0]}~${globalMonths.at(-1)}`
      : null,
    canonicalAnalysisAsOf: analysisAsOf,
    chunkEvidenceCount: chunks.length,
    rows,
    fingerprint: sha256({
      backfillRequestId: backfill.requestId,
      canonicalFingerprint: canonical.snapshot?.contentFingerprint ?? null,
      chunks: chunks.map((row) => [
        text(row.source_event_id),
        text(row.started_at),
      ]),
      rows,
    }),
    businessWritesPerformed: false,
    inventoryWritesEnabled: false,
  };
}
