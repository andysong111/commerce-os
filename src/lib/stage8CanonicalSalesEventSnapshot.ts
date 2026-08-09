import { createHash } from "node:crypto";
import {
  combineProductMasterShoplingSalesEventChunks,
  type ProductMasterShoplingSalesEventChunk,
} from "@/lib/productMasterShoplingSalesEventEngine";
import {
  SALES_EVENT_CHUNK,
  loadProductMasterShoplingSalesEventSyncStatus,
} from "@/lib/productMasterShoplingSalesEventSync";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type OperationRow = {
  result_snapshot?: unknown;
  started_at?: unknown;
};

type CombinedSalesEvent = ReturnType<
  typeof combineProductMasterShoplingSalesEventChunks
>["events"][number];

export type Stage8CanonicalSalesEventSnapshot = {
  generatedAt: string;
  state: "READY_READ_ONLY" | "BLOCKED";
  requestId: string | null;
  analysisAsOf: string | null;
  eventFingerprint: string | null;
  eventCount: number;
  validEventCount: number;
  coverageStartAt: string | null;
  coverageEndAt: string | null;
  fingerprint: string;
  writesEnabled: false;
  events: CombinedSalesEvent[];
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

async function loadSalesEventChunks(requestId: string) {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const correlationId = `product-master-sales-events:${requestId}`;
  const result = await admin
    .from("commerce_operation_runs")
    .select("result_snapshot,started_at")
    .eq("operation_type", SALES_EVENT_CHUNK)
    .eq("correlation_id", correlationId)
    .order("started_at", { ascending: true })
    .limit(500);
  if (result.error) throw new Error(result.error.message);
  return (Array.isArray(result.data) ? result.data : [])
    .map((row) => row as OperationRow)
    .map((row) => object(row.result_snapshot))
    .filter((snapshot) => Array.isArray(snapshot.events) && snapshot.range)
    .map((snapshot) => snapshot as unknown as ProductMasterShoplingSalesEventChunk);
}

export async function loadStage8CanonicalSalesEventSnapshot(): Promise<Stage8CanonicalSalesEventSnapshot> {
  const generatedAt = new Date().toISOString();
  const status = await loadProductMasterShoplingSalesEventSyncStatus();
  if (status.state !== "COMPLETED" || !status.requestId) {
    return {
      generatedAt,
      state: "BLOCKED",
      requestId: status.requestId,
      analysisAsOf: status.analysisAsOf,
      eventFingerprint: status.report?.eventFingerprint ?? null,
      eventCount: 0,
      validEventCount: 0,
      coverageStartAt: null,
      coverageEndAt: null,
      fingerprint: sha256({ state: "BLOCKED", requestId: status.requestId }),
      writesEnabled: false,
      events: [],
    };
  }

  const chunks = await loadSalesEventChunks(status.requestId);
  const combined = combineProductMasterShoplingSalesEventChunks(chunks);
  const validEvents = combined.events.filter(
    (event) => event.validSale && Number.isFinite(Date.parse(event.occurredAt)),
  );
  const orderedDates = validEvents
    .map((event) => event.occurredAt)
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  const stable = {
    requestId: status.requestId,
    analysisAsOf: status.analysisAsOf,
    eventFingerprint: status.report?.eventFingerprint ?? null,
    eventCount: combined.events.length,
    validEventCount: validEvents.length,
    coverageStartAt: orderedDates[0] ?? null,
    coverageEndAt: orderedDates.at(-1) ?? null,
  };

  return {
    generatedAt,
    state: "READY_READ_ONLY",
    requestId: status.requestId,
    analysisAsOf: status.analysisAsOf,
    eventFingerprint: status.report?.eventFingerprint ?? null,
    eventCount: combined.events.length,
    validEventCount: validEvents.length,
    coverageStartAt: orderedDates[0] ?? null,
    coverageEndAt: orderedDates.at(-1) ?? null,
    fingerprint: sha256(stable),
    writesEnabled: false,
    events: combined.events,
  };
}
