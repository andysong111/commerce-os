import { createHash } from "node:crypto";
import { legacyOrderSurrogateValidationEvidence } from "@/data/stage8LegacyOrderSurrogateValidationEvidence";
import { provisionalInventoryValidationEvidenceByBarcode } from "@/data/stage8ProvisionalInventoryValidationEvidence";
import {
  combineProductMasterShoplingSalesEventChunks,
  type ProductMasterShoplingSalesEventChunk,
} from "@/lib/productMasterShoplingSalesEventEngine";
import {
  SALES_EVENT_CHUNK,
  loadProductMasterShoplingSalesEventSyncStatus,
} from "@/lib/productMasterShoplingSalesEventSync";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const TARGET_BARCODE = "BGG1-1";
const LEAD_DAY_SCENARIOS = [0, 7, 14, 21] as const;

type OperationRow = {
  result_snapshot?: unknown;
  started_at?: unknown;
};

export type LatestOrderProvisionalScenario = {
  leadDays: number;
  deductionStartDate: string;
  canonicalSalesSinceStart: number;
  latestOrderQuantity: number;
  diagnosticResidualQuantity: number;
  physicalQuantity: number;
  deltaToPhysical: number;
  absoluteErrorPct: number;
  conservativeRelativeToPhysical: boolean;
};

export type LatestOrderProvisionalValidation = {
  generatedAt: string;
  state: "READY_VALIDATION_ONLY" | "BLOCKED";
  message: string;
  barcode: string;
  modelNumber: string;
  productName: string;
  latestOrderDate: string;
  latestOrderQuantity: number;
  sourceArtifact: string;
  salesEventRequestId: string | null;
  salesEventAnalysisAsOf: string | null;
  canonicalEventCount: number;
  canonicalTargetValidEventCount: number;
  canonicalTarget360Quantity: number;
  physicalQuantity: number;
  physicalObservedOn: string;
  scenarios: LatestOrderProvisionalScenario[];
  bestLeadDaysByPhysicalError: number | null;
  bestDiagnosticResidualQuantity: number | null;
  bestAbsoluteErrorPct: number | null;
  fingerprint: string;
  confirmedInbound: false;
  inventoryUseAllowed: false;
  operationalEstimatePromotionAllowed: false;
  inventoryWritesEnabled: false;
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

function datePlusDays(date: string, days: number) {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) throw new Error("LATEST_ORDER_DATE_INVALID");
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
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

function scenario(input: {
  latestOrderDate: string;
  latestOrderQuantity: number;
  physicalQuantity: number;
  leadDays: number;
  targetEvents: ReturnType<typeof combineProductMasterShoplingSalesEventChunks>["events"];
}): LatestOrderProvisionalScenario {
  const deductionStartDate = datePlusDays(input.latestOrderDate, input.leadDays);
  const cutoff = Date.parse(`${deductionStartDate}T00:00:00.000Z`);
  const canonicalSalesSinceStart = input.targetEvents
    .filter((event) => event.validSale && Date.parse(event.occurredAt) >= cutoff)
    .reduce((sum, event) => sum + Math.max(0, Math.round(event.quantity)), 0);
  const diagnosticResidualQuantity = Math.max(
    0,
    input.latestOrderQuantity - canonicalSalesSinceStart,
  );
  const deltaToPhysical = diagnosticResidualQuantity - input.physicalQuantity;
  const absoluteErrorPct = input.physicalQuantity > 0
    ? Math.round((Math.abs(deltaToPhysical) / input.physicalQuantity) * 10_000) / 100
    : 0;
  return {
    leadDays: input.leadDays,
    deductionStartDate,
    canonicalSalesSinceStart,
    latestOrderQuantity: input.latestOrderQuantity,
    diagnosticResidualQuantity,
    physicalQuantity: input.physicalQuantity,
    deltaToPhysical,
    absoluteErrorPct,
    conservativeRelativeToPhysical: diagnosticResidualQuantity <= input.physicalQuantity,
  };
}

export async function loadLatestOrderProvisionalValidation(): Promise<LatestOrderProvisionalValidation> {
  const source = legacyOrderSurrogateValidationEvidence().find(
    (row) => normalizeBarcode(row.barcode) === TARGET_BARCODE,
  );
  const physical = provisionalInventoryValidationEvidenceByBarcode().get(TARGET_BARCODE) ?? null;
  const status = await loadProductMasterShoplingSalesEventSyncStatus();
  if (!source || !physical || status.state !== "COMPLETED" || !status.requestId) {
    return {
      generatedAt: new Date().toISOString(),
      state: "BLOCKED",
      message: "최신 과거 발주자료·실물 검증표본·완료된 Canonical 판매 이벤트 원장이 모두 있어야 계산합니다.",
      barcode: TARGET_BARCODE,
      modelNumber: source?.modelNumber ?? "",
      productName: source?.productName ?? "",
      latestOrderDate: source?.latestOrderDate ?? "",
      latestOrderQuantity: source?.latestOrderQuantity ?? 0,
      sourceArtifact: source?.sourceArtifact ?? "",
      salesEventRequestId: status.requestId,
      salesEventAnalysisAsOf: status.analysisAsOf,
      canonicalEventCount: 0,
      canonicalTargetValidEventCount: 0,
      canonicalTarget360Quantity: 0,
      physicalQuantity: physical?.physicalQuantity ?? 0,
      physicalObservedOn: physical?.observedOn ?? "",
      scenarios: [],
      bestLeadDaysByPhysicalError: null,
      bestDiagnosticResidualQuantity: null,
      bestAbsoluteErrorPct: null,
      fingerprint: sha256({ state: "BLOCKED", requestId: status.requestId }),
      confirmedInbound: false,
      inventoryUseAllowed: false,
      operationalEstimatePromotionAllowed: false,
      inventoryWritesEnabled: false,
    };
  }

  const chunks = await loadSalesEventChunks(status.requestId);
  const combined = combineProductMasterShoplingSalesEventChunks(chunks);
  const targetEvents = combined.events.filter(
    (event) => normalizeBarcode(event.barcode) === TARGET_BARCODE,
  );
  const canonicalTarget360Quantity = targetEvents
    .filter((event) => event.validSale)
    .reduce((sum, event) => sum + Math.max(0, Math.round(event.quantity)), 0);
  const scenarios = LEAD_DAY_SCENARIOS.map((leadDays) =>
    scenario({
      latestOrderDate: source.latestOrderDate,
      latestOrderQuantity: source.latestOrderQuantity,
      physicalQuantity: physical.physicalQuantity,
      leadDays,
      targetEvents,
    }),
  );
  const best = [...scenarios].sort(
    (left, right) =>
      left.absoluteErrorPct - right.absoluteErrorPct ||
      left.leadDays - right.leadDays,
  )[0] ?? null;

  const stable = {
    requestId: status.requestId,
    analysisAsOf: status.analysisAsOf,
    eventFingerprint: status.report?.eventFingerprint ?? null,
    barcode: TARGET_BARCODE,
    latestOrderDate: source.latestOrderDate,
    latestOrderQuantity: source.latestOrderQuantity,
    physicalQuantity: physical.physicalQuantity,
    scenarios,
  };
  return {
    generatedAt: new Date().toISOString(),
    state: "READY_VALIDATION_ONLY",
    message: "누적 과거 발주 전체를 재고로 쓰는 대신, 가장 최근 과거 발주 1회 수량에서 그 뒤 Canonical 판매를 차감하는 후보식을 0·7·14·21일 입고지연 가정으로 비교합니다. 과거 발주는 확정입고가 아니므로 결과는 검증용이며 자동 승격하지 않습니다.",
    barcode: TARGET_BARCODE,
    modelNumber: source.modelNumber,
    productName: source.productName,
    latestOrderDate: source.latestOrderDate,
    latestOrderQuantity: source.latestOrderQuantity,
    sourceArtifact: source.sourceArtifact,
    salesEventRequestId: status.requestId,
    salesEventAnalysisAsOf: status.analysisAsOf,
    canonicalEventCount: combined.events.length,
    canonicalTargetValidEventCount: targetEvents.filter((event) => event.validSale).length,
    canonicalTarget360Quantity,
    physicalQuantity: physical.physicalQuantity,
    physicalObservedOn: physical.observedOn,
    scenarios,
    bestLeadDaysByPhysicalError: best?.leadDays ?? null,
    bestDiagnosticResidualQuantity: best?.diagnosticResidualQuantity ?? null,
    bestAbsoluteErrorPct: best?.absoluteErrorPct ?? null,
    fingerprint: sha256(stable),
    confirmedInbound: false,
    inventoryUseAllowed: false,
    operationalEstimatePromotionAllowed: false,
    inventoryWritesEnabled: false,
  };
}
