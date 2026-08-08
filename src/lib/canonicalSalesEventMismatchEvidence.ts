import { createHash } from "node:crypto";
import {
  CANONICAL_EVENT_INCREMENTAL_SHADOW_CHUNK,
  CANONICAL_EVENT_INCREMENTAL_SHADOW_VERIFY,
  loadCanonicalSalesEventIncrementalShadowStatus,
} from "@/lib/canonicalSalesEventIncrementalShadow";
import {
  PRODUCT_MASTER_SALES_EVENT_FORMAT,
  PRODUCT_MASTER_SALES_EVENT_SOURCE,
  combineProductMasterShoplingSalesEventChunks,
  type ProductMasterSalesEventRow,
  type ProductMasterShoplingSalesEventChunk,
} from "@/lib/productMasterShoplingSalesEventEngine";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import {
  createSupabaseAdminClient,
  createSupabaseAdminHeaders,
} from "@/lib/supabase/admin";

export const CANONICAL_EVENT_MISMATCH_EVIDENCE_REPORT =
  "CANONICAL_EVENT_MISMATCH_EVIDENCE_REPORT";
export const CANONICAL_EVENT_MISMATCH_EVIDENCE_FAILURE =
  "CANONICAL_EVENT_MISMATCH_EVIDENCE_FAILURE";

const DEFAULT_PRODUCT_MASTER_URL = "https://commerce-os-product-master.vercel.app";
const MAX_DETAIL_SAMPLES = 100;
const VERIFY_BATCH_SIZE = 1_000;
const OPERATION_LIMIT = 500;
const MANAGED_BARCODE = /^B[A-Z]{2}\d+-\d+$/;

type OperationRow = {
  status?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  error_message?: unknown;
  started_at?: unknown;
};

type ProductMasterMismatchDetail = {
  externalId: string;
  differences: string[];
  persisted: null | {
    skuId: string;
    occurredAt: string;
    quantity: number;
    revenue: number;
    validSale: boolean;
  };
};

export type CanonicalEventMismatchEvidenceDetail = {
  externalId: string;
  changeKind:
    | "NEW"
    | "STATUS"
    | "QUANTITY"
    | "REVENUE"
    | "MULTI_FIELD"
    | "OCCURRED_AT"
    | "IDENTITY"
    | "OTHER";
  differences: string[];
  expectedSkuId: string | null;
  candidate: {
    barcode: string;
    occurredAt: string;
    quantity: number;
    revenue: number;
    validSale: boolean;
  };
  persisted: ProductMasterMismatchDetail["persisted"];
};

export type CanonicalEventMismatchEvidenceReport = {
  generatedAt: string;
  shadowRequestId: string;
  analysisAsOf: string;
  candidateFingerprint: string;
  shadowPendingMismatchCount: number;
  inspectedMismatchCount: number;
  newEventCount: number;
  statusChangeCount: number;
  quantityChangeCount: number;
  revenueChangeCount: number;
  occurredAtChangeCount: number;
  metadataChangeCount: number;
  identityMismatchCount: number;
  multiFieldCount: number;
  candidateValidCount: number;
  candidateTombstoneCount: number;
  canaryEligibleCount: number;
  unsafeForCanaryCount: number;
  canaryEligible: boolean;
  automaticWriteEnabled: false;
  writesEnabled: false;
  detailSamples: CanonicalEventMismatchEvidenceDetail[];
};

export type CanonicalEventMismatchEvidenceStatus = {
  state: "WAITING_SHADOW" | "NO_CHANGES" | "READY" | "BLOCKED" | "FAILED";
  message: string;
  report: CanonicalEventMismatchEvidenceReport | null;
  writesEnabled: false;
  error: string | null;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value: unknown) {
  return Math.max(0, Math.round(numeric(value)));
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : text(error);
  return message
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[A-Za-z0-9+/=_-]{48,}/g, "[redacted]")
    .slice(0, 1000);
}

function normalizeBarcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function correlationId(requestId: string) {
  return `canonical-sales-event-incremental-shadow:${requestId}`;
}

function productMasterConnection() {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  if (!secret) throw new Error("PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED");
  const baseUrl = (
    process.env.PRODUCT_MASTER_BASE_URL?.trim() || DEFAULT_PRODUCT_MASTER_URL
  ).replace(/\/$/, "");
  if (!/^https:\/\//.test(baseUrl)) throw new Error("PRODUCT_MASTER_BASE_URL_INVALID");
  return { baseUrl, secret };
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

async function readOperations(operationType: string, requestId: string) {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const result = await admin
    .from("commerce_operation_runs")
    .select("status,input_snapshot,result_snapshot,error_message,started_at")
    .eq("operation_type", operationType)
    .eq("correlation_id", correlationId(requestId))
    .order("started_at", { ascending: false })
    .limit(OPERATION_LIMIT);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as OperationRow[];
}

async function readEvidenceReports() {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const result = await admin
    .from("commerce_operation_runs")
    .select("status,input_snapshot,result_snapshot,error_message,started_at")
    .eq("operation_type", CANONICAL_EVENT_MISMATCH_EVIDENCE_REPORT)
    .order("started_at", { ascending: false })
    .limit(20);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as OperationRow[];
}

async function storeEvidenceOperation(input: {
  operationType: string;
  sourceEventId: string;
  correlationId: string;
  status?: "SUCCEEDED" | "FAILED";
  inputSnapshot: unknown;
  resultSnapshot: unknown;
  errorMessage?: string | null;
}) {
  const { baseUrl, secret } = supabaseConnection();
  const occurredAt = new Date().toISOString();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=id,source_event_id,started_at`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          operation_type: input.operationType,
          status: input.status ?? "SUCCEEDED",
          source: "ops-center-canonical-event-mismatch-evidence",
          source_event_id: input.sourceEventId,
          correlation_id: input.correlationId,
          actor_type: "SYSTEM",
          input_snapshot: input.inputSnapshot,
          result_snapshot: input.resultSnapshot,
          error_message: input.errorMessage ?? null,
          started_at: occurredAt,
          finished_at: occurredAt,
          updated_at: occurredAt,
        },
      ]),
      cache: "no-store",
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `CANONICAL_EVENT_MISMATCH_EVIDENCE_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
    );
  }
}

function chunkFromRow(row: OperationRow) {
  const value = object(row.result_snapshot);
  const range = object(value.range);
  const events = Array.isArray(value.events)
    ? value.events.map(object).map((event) => ({
        externalId: text(event.externalId),
        barcode: text(event.barcode),
        occurredAt: text(event.occurredAt),
        quantity: integer(event.quantity),
        revenue: integer(event.revenue),
        validSale: event.validSale === true,
        syncedAt: text(event.syncedAt),
      }))
    : [];
  if (!text(range.start) || !text(range.end)) return null;
  return {
    range: { start: text(range.start), end: text(range.end) },
    fetchedRows: integer(value.fetchedRows),
    eventRows: integer(value.eventRows),
    validRows: integer(value.validRows),
    tombstoneRows: integer(value.tombstoneRows),
    ignoredRows: integer(value.ignoredRows),
    unmappedRows: integer(value.unmappedRows),
    duplicateRows: integer(value.duplicateRows),
    totalBaseUnits: integer(value.totalBaseUnits),
    totalRevenue: integer(value.totalRevenue),
    events,
    unmappedSamples: Array.isArray(value.unmappedSamples)
      ? (value.unmappedSamples as ProductMasterShoplingSalesEventChunk["unmappedSamples"])
      : [],
  } satisfies ProductMasterShoplingSalesEventChunk;
}

function candidateFingerprint(events: ProductMasterSalesEventRow[]) {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify(
        events.map((event) => ({
          externalId: event.externalId,
          barcode: event.barcode,
          occurredAt: event.occurredAt,
          quantity: event.quantity,
          revenue: event.revenue,
          validSale: event.validSale,
        })),
      ),
    )
    .digest("hex")}`;
}

function mismatchIdsFromVerifyRows(rows: OperationRow[]) {
  const output: string[] = [];
  for (const row of rows) {
    const value = object(row.result_snapshot);
    if (!Array.isArray(value.mismatchExternalIds)) continue;
    output.push(...value.mismatchExternalIds.map(text).filter(Boolean));
  }
  return [...new Set(output)].sort();
}

async function inspectProductMasterEvents(events: ProductMasterSalesEventRow[]) {
  const { baseUrl, secret } = productMasterConnection();
  const details: ProductMasterMismatchDetail[] = [];
  let verifiedRows = 0;
  for (let index = 0; index < events.length; index += VERIFY_BATCH_SIZE) {
    const batch = events.slice(index, index + VERIFY_BATCH_SIZE);
    const response = await fetch(`${baseUrl}/api/integrations/sales-events/verify`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-commerce-os-integration-secret": secret,
      },
      body: JSON.stringify({
        format: PRODUCT_MASTER_SALES_EVENT_FORMAT,
        source: PRODUCT_MASTER_SALES_EVENT_SOURCE,
        rows: batch,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || payload.ok !== true || payload.writesEnabled !== false) {
      throw new Error(text(payload.message) || `MISMATCH_EVIDENCE_VERIFY_FAILED:${response.status}`);
    }
    const batchDetails = Array.isArray(payload.mismatchDetails)
      ? payload.mismatchDetails.map(object).map((detail) => {
          const persisted = detail.persisted === null ? null : object(detail.persisted);
          return {
            externalId: text(detail.externalId),
            differences: Array.isArray(detail.differences)
              ? detail.differences.map(text).filter(Boolean)
              : [],
            persisted:
              persisted === null
                ? null
                : {
                    skuId: text(persisted.skuId),
                    occurredAt: text(persisted.occurredAt),
                    quantity: integer(persisted.quantity),
                    revenue: integer(persisted.revenue),
                    validSale: persisted.validSale === true,
                  },
          } satisfies ProductMasterMismatchDetail;
        })
      : [];
    verifiedRows += integer(payload.verifiedRows);
    details.push(...batchDetails);
    const mismatchCount = integer(payload.mismatchCount);
    if (batchDetails.length !== mismatchCount || verifiedRows > events.length) {
      throw new Error("MISMATCH_EVIDENCE_DETAIL_ACCOUNTING_INVALID");
    }
  }
  return { verifiedRows, details };
}

function expectedSkuIndex(
  products: Awaited<ReturnType<typeof loadProductPlanningSnapshot>>["products"],
) {
  const index = new Map<string, string | null>();
  const grouped = new Map<string, Set<string>>();
  for (const product of products) {
    const barcode = normalizeBarcode(product.barcode);
    const skuId = text(product.skuId);
    if (!MANAGED_BARCODE.test(barcode) || !skuId) continue;
    const ids = grouped.get(barcode) ?? new Set<string>();
    ids.add(skuId);
    grouped.set(barcode, ids);
  }
  for (const [barcode, ids] of grouped) {
    index.set(barcode, ids.size === 1 ? [...ids][0] : null);
  }
  return index;
}

function classifyDetail(
  event: ProductMasterSalesEventRow,
  detail: ProductMasterMismatchDetail,
  expectedSkuId: string | null,
): CanonicalEventMismatchEvidenceDetail {
  const differences = [...new Set(detail.differences.map(text).filter(Boolean))];
  if (
    detail.persisted &&
    expectedSkuId &&
    detail.persisted.skuId !== expectedSkuId
  ) {
    differences.push("SKU_IDENTITY");
  }
  const unique = [...new Set(differences)];
  let changeKind: CanonicalEventMismatchEvidenceDetail["changeKind"] = "OTHER";
  if (detail.persisted === null || unique.includes("MISSING")) changeKind = "NEW";
  else if (unique.includes("SKU_IDENTITY") || unique.some((value) => ["ID", "SOURCE", "EXTERNAL_ID"].includes(value))) changeKind = "IDENTITY";
  else if (unique.includes("OCCURRED_AT")) changeKind = "OCCURRED_AT";
  else if (unique.length > 1) changeKind = "MULTI_FIELD";
  else if (unique[0] === "VALID_SALE") changeKind = "STATUS";
  else if (unique[0] === "QUANTITY") changeKind = "QUANTITY";
  else if (unique[0] === "REVENUE") changeKind = "REVENUE";
  return {
    externalId: event.externalId,
    changeKind,
    differences: unique,
    expectedSkuId,
    candidate: {
      barcode: event.barcode,
      occurredAt: event.occurredAt,
      quantity: event.quantity,
      revenue: event.revenue,
      validSale: event.validSale,
    },
    persisted: detail.persisted,
  };
}

function reportFromRow(row: OperationRow) {
  const value = object(row.result_snapshot);
  const generatedAt = iso(value.generatedAt);
  const shadowRequestId = text(value.shadowRequestId);
  const candidateFingerprintValue = text(value.candidateFingerprint);
  if (!generatedAt || !shadowRequestId || !/^sha256:[a-f0-9]{64}$/.test(candidateFingerprintValue)) return null;
  return value as unknown as CanonicalEventMismatchEvidenceReport;
}

export async function runCanonicalEventMismatchEvidence() {
  const shadow = await loadCanonicalSalesEventIncrementalShadowStatus();
  const shadowReport = shadow.report;
  if (shadow.state !== "SHADOW_READY" || !shadowReport || !shadow.requestId || !shadow.analysisAsOf) {
    return {
      processed: false,
      state: "WAITING_SHADOW" as const,
      message: `Exact-event incremental shadow가 ${shadow.state} 상태라 mismatch 증거를 기다립니다.`,
    };
  }

  const reports = await readEvidenceReports();
  const existing = reports
    .map(reportFromRow)
    .find((report) => report?.candidateFingerprint === shadowReport.candidateFingerprint);
  if (existing) {
    return {
      processed: false,
      state: existing.shadowPendingMismatchCount ? "READY" as const : "NO_CHANGES" as const,
      report: existing,
      message: "현재 candidate fingerprint의 mismatch 증거가 이미 완성되었습니다.",
    };
  }

  const evidenceCorrelationId = `canonical-event-mismatch-evidence:${shadowReport.candidateFingerprint}`;
  try {
    if (shadowReport.pendingMismatchCount === 0) {
      const report: CanonicalEventMismatchEvidenceReport = {
        generatedAt: new Date().toISOString(),
        shadowRequestId: shadow.requestId,
        analysisAsOf: shadow.analysisAsOf,
        candidateFingerprint: shadowReport.candidateFingerprint,
        shadowPendingMismatchCount: 0,
        inspectedMismatchCount: 0,
        newEventCount: 0,
        statusChangeCount: 0,
        quantityChangeCount: 0,
        revenueChangeCount: 0,
        occurredAtChangeCount: 0,
        metadataChangeCount: 0,
        identityMismatchCount: 0,
        multiFieldCount: 0,
        candidateValidCount: 0,
        candidateTombstoneCount: 0,
        canaryEligibleCount: 0,
        unsafeForCanaryCount: 0,
        canaryEligible: true,
        automaticWriteEnabled: false,
        writesEnabled: false,
        detailSamples: [],
      };
      await storeEvidenceOperation({
        operationType: CANONICAL_EVENT_MISMATCH_EVIDENCE_REPORT,
        sourceEventId: `canonical-event-mismatch-evidence-report:${shadowReport.candidateFingerprint}`,
        correlationId: evidenceCorrelationId,
        inputSnapshot: {
          shadowRequestId: shadow.requestId,
          candidateFingerprint: shadowReport.candidateFingerprint,
        },
        resultSnapshot: report,
      });
      return {
        processed: true,
        state: "NO_CHANGES" as const,
        report,
        message: "현재 4개월 overlap 후보는 Product Master와 전부 exact match라 변경 증거가 0건입니다.",
      };
    }

    const [chunkRows, verifyRows, planning] = await Promise.all([
      readOperations(CANONICAL_EVENT_INCREMENTAL_SHADOW_CHUNK, shadow.requestId),
      readOperations(CANONICAL_EVENT_INCREMENTAL_SHADOW_VERIFY, shadow.requestId),
      loadProductPlanningSnapshot(),
    ]);
    const chunks = chunkRows.map(chunkFromRow).filter(Boolean) as ProductMasterShoplingSalesEventChunk[];
    const combined = combineProductMasterShoplingSalesEventChunks(chunks);
    const fingerprint = candidateFingerprint(combined.events);
    if (fingerprint !== shadowReport.candidateFingerprint) {
      throw new Error("MISMATCH_EVIDENCE_CANDIDATE_FINGERPRINT_DRIFT");
    }
    const mismatchIds = mismatchIdsFromVerifyRows(verifyRows);
    if (mismatchIds.length !== shadowReport.pendingMismatchCount) {
      throw new Error(
        `MISMATCH_EVIDENCE_SHADOW_COUNT_DRIFT:${mismatchIds.length}:${shadowReport.pendingMismatchCount}`,
      );
    }
    const mismatchSet = new Set(mismatchIds);
    const candidates = combined.events.filter((event) => mismatchSet.has(event.externalId));
    if (candidates.length !== mismatchIds.length) {
      throw new Error("MISMATCH_EVIDENCE_CANDIDATE_COVERAGE_INVALID");
    }

    const inspection = await inspectProductMasterEvents(candidates);
    if (inspection.verifiedRows !== 0 || inspection.details.length !== candidates.length) {
      throw new Error(
        `MISMATCH_EVIDENCE_PERSISTED_CHANGED_SINCE_SHADOW:${inspection.verifiedRows}:${inspection.details.length}:${candidates.length}`,
      );
    }
    const detailById = new Map(inspection.details.map((detail) => [detail.externalId, detail]));
    const skuIndex = expectedSkuIndex(planning.products);
    const details = candidates.map((event) => {
      const detail = detailById.get(event.externalId);
      if (!detail) throw new Error(`MISMATCH_EVIDENCE_DETAIL_MISSING:${event.externalId}`);
      const barcode = normalizeBarcode(event.barcode);
      const expectedSkuId = skuIndex.get(barcode) ?? null;
      return classifyDetail(event, detail, expectedSkuId);
    });

    const countDifference = (name: string) =>
      details.filter((detail) => detail.differences.includes(name)).length;
    const newEventCount = details.filter((detail) => detail.changeKind === "NEW").length;
    const statusChangeCount = countDifference("VALID_SALE");
    const quantityChangeCount = countDifference("QUANTITY");
    const revenueChangeCount = countDifference("REVENUE");
    const occurredAtChangeCount = countDifference("OCCURRED_AT");
    const metadataChangeCount = details.filter((detail) =>
      detail.differences.some((difference) => ["ID", "SOURCE", "EXTERNAL_ID"].includes(difference)),
    ).length;
    const identityMismatchCount = details.filter((detail) =>
      detail.differences.includes("SKU_IDENTITY") || detail.expectedSkuId === null,
    ).length;
    const multiFieldCount = details.filter((detail) => detail.differences.length > 1).length;
    const safeKinds = new Set(["NEW", "STATUS", "QUANTITY", "REVENUE", "MULTI_FIELD"]);
    const canaryEligibleRows = details.filter(
      (detail) =>
        safeKinds.has(detail.changeKind) &&
        detail.expectedSkuId !== null &&
        !detail.differences.some((difference) =>
          ["ID", "SOURCE", "EXTERNAL_ID", "OCCURRED_AT", "SKU_IDENTITY"].includes(difference),
        ),
    );
    const report: CanonicalEventMismatchEvidenceReport = {
      generatedAt: new Date().toISOString(),
      shadowRequestId: shadow.requestId,
      analysisAsOf: shadow.analysisAsOf,
      candidateFingerprint: shadowReport.candidateFingerprint,
      shadowPendingMismatchCount: shadowReport.pendingMismatchCount,
      inspectedMismatchCount: details.length,
      newEventCount,
      statusChangeCount,
      quantityChangeCount,
      revenueChangeCount,
      occurredAtChangeCount,
      metadataChangeCount,
      identityMismatchCount,
      multiFieldCount,
      candidateValidCount: details.filter((detail) => detail.candidate.validSale).length,
      candidateTombstoneCount: details.filter((detail) => !detail.candidate.validSale).length,
      canaryEligibleCount: canaryEligibleRows.length,
      unsafeForCanaryCount: details.length - canaryEligibleRows.length,
      canaryEligible:
        canaryEligibleRows.length === details.length &&
        identityMismatchCount === 0 &&
        metadataChangeCount === 0 &&
        occurredAtChangeCount === 0,
      automaticWriteEnabled: false,
      writesEnabled: false,
      detailSamples: details.slice(0, MAX_DETAIL_SAMPLES),
    };
    await storeEvidenceOperation({
      operationType: CANONICAL_EVENT_MISMATCH_EVIDENCE_REPORT,
      sourceEventId: `canonical-event-mismatch-evidence-report:${shadowReport.candidateFingerprint}`,
      correlationId: evidenceCorrelationId,
      inputSnapshot: {
        shadowRequestId: shadow.requestId,
        candidateFingerprint: shadowReport.candidateFingerprint,
        mismatchCount: shadowReport.pendingMismatchCount,
      },
      resultSnapshot: report,
    });
    return {
      processed: true,
      state: "READY" as const,
      report,
      message: `신규·변경 ${details.length}건을 persisted 이전값과 대조했습니다. Canary 가능 ${report.canaryEligibleCount}건 · 차단 ${report.unsafeForCanaryCount}건이며 실제 쓰기는 비활성입니다.`,
    };
  } catch (error) {
    const message = safeMessage(error);
    await storeEvidenceOperation({
      operationType: CANONICAL_EVENT_MISMATCH_EVIDENCE_FAILURE,
      sourceEventId: `canonical-event-mismatch-evidence-failure:${shadowReport.candidateFingerprint}`,
      correlationId: evidenceCorrelationId,
      status: "FAILED",
      inputSnapshot: {
        shadowRequestId: shadow.requestId,
        candidateFingerprint: shadowReport.candidateFingerprint,
      },
      resultSnapshot: { message, writesEnabled: false },
      errorMessage: message,
    });
    return { processed: false, state: "FAILED" as const, message };
  }
}

export async function loadCanonicalEventMismatchEvidenceStatus(): Promise<CanonicalEventMismatchEvidenceStatus> {
  const shadow = await loadCanonicalSalesEventIncrementalShadowStatus();
  const shadowReport = shadow.report;
  if (shadow.state !== "SHADOW_READY" || !shadowReport) {
    return {
      state: "WAITING_SHADOW",
      message: `Exact-event incremental shadow 상태 ${shadow.state}를 기다립니다.`,
      report: null,
      writesEnabled: false,
      error: null,
    };
  }
  const reports = await readEvidenceReports();
  const report = reports
    .map(reportFromRow)
    .find((row) => row?.candidateFingerprint === shadowReport.candidateFingerprint) ?? null;
  if (report) {
    return {
      state: report.shadowPendingMismatchCount ? "READY" : "NO_CHANGES",
      message: report.shadowPendingMismatchCount
        ? `신규·변경 ${report.inspectedMismatchCount}건 분류 완료 · canary 가능 ${report.canaryEligibleCount}건 · 차단 ${report.unsafeForCanaryCount}건.`
        : "현재 overlap에는 신규·변경 후보가 없습니다.",
      report,
      writesEnabled: false,
      error: null,
    };
  }
  const admin = await createSupabaseAdminClient();
  if (!admin) {
    return {
      state: "FAILED",
      message: "Supabase admin 연결이 없어 mismatch evidence를 읽지 못했습니다.",
      report: null,
      writesEnabled: false,
      error: "SUPABASE_ADMIN_NOT_CONFIGURED",
    };
  }
  const failures = await admin
    .from("commerce_operation_runs")
    .select("error_message,result_snapshot,started_at")
    .eq("operation_type", CANONICAL_EVENT_MISMATCH_EVIDENCE_FAILURE)
    .eq("correlation_id", `canonical-event-mismatch-evidence:${shadowReport.candidateFingerprint}`)
    .order("started_at", { ascending: false })
    .limit(1);
  if (failures.error) throw new Error(failures.error.message);
  const failure = failures.data?.[0] as OperationRow | undefined;
  if (failure) {
    const error = safeMessage(failure.error_message || object(failure.result_snapshot).message);
    return {
      state: "FAILED",
      message: error,
      report: null,
      writesEnabled: false,
      error,
    };
  }
  return {
    state: "BLOCKED",
    message: "Shadow는 완료됐지만 persisted mismatch 상세 분류가 아직 실행되지 않았습니다.",
    report: null,
    writesEnabled: false,
    error: null,
  };
}
