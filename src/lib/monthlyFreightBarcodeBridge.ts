import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { seoulCalendarMonth } from "@/lib/monthlyPurchasePolicy";

export type MonthlyFreightBarcodeOrderLine = {
  sourceEventId: string;
  draftId: string;
  occurredAt: string;
  cycleMonth: string;
  barcode: string;
  modelNo: string;
  modelName: string;
  productName: string;
  saleOption: string;
  chinaOption: string;
  supplierLink: string;
  orderNumber: string;
  orderedQuantity: number;
  unitPriceCny: number | null;
};

type StoredRow = {
  source_event_id?: unknown;
  input_snapshot?: unknown;
  started_at?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function orderLineFromRow(row: StoredRow): MonthlyFreightBarcodeOrderLine | null {
  const snapshot = object(row.input_snapshot);
  if (text(snapshot.status) !== "ORDERED") return null;

  const payload = object(snapshot.payload);
  const occurredAt =
    text(snapshot.occurredAt) || text(row.started_at) || new Date(0).toISOString();
  const cycleMonth = text(payload.cycleMonth) || seoulCalendarMonth(occurredAt);
  const barcode = text(snapshot.barcode).toUpperCase();
  if (!barcode || barcode.startsWith("UNASSIGNED-")) return null;

  const orderedQuantity = Math.max(0, Math.round(Number(snapshot.orderedQuantity) || Number(payload.quantity) || 0));
  if (orderedQuantity <= 0) return null;

  return {
    sourceEventId: text(snapshot.sourceEventId) || text(row.source_event_id),
    draftId: text(snapshot.sourceRunId),
    occurredAt,
    cycleMonth,
    barcode,
    modelNo: text(payload.modelNo),
    modelName: text(payload.modelName),
    productName: text(payload.productName) || text(payload.modelName),
    saleOption: text(payload.saleOption),
    chinaOption: text(payload.chinaOption),
    supplierLink: text(payload.supplierLink),
    orderNumber: text(payload.orderNumber),
    orderedQuantity,
    unitPriceCny: numberOrNull(payload.unitPriceCny),
  };
}

export async function loadMonthlyFreightBarcodeOrderLines(cycleMonth: string) {
  if (!/^\d{4}-\d{2}$/.test(cycleMonth)) {
    throw new Error("MONTHLY_FREIGHT_BARCODE_MONTH_INVALID");
  }

  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");

  const result = await admin
    .from("commerce_operation_runs")
    .select("source_event_id,input_snapshot,started_at")
    .eq("operation_type", "CHINA_ORDER_COMMITMENT_EVENT")
    .eq("status", "SUCCEEDED")
    .order("started_at", { ascending: false })
    .limit(5000);

  if (result.error) throw new Error(result.error.message);

  const seen = new Set<string>();
  const rows = (Array.isArray(result.data) ? result.data : [])
    .map((row) => orderLineFromRow(row as StoredRow))
    .filter((row): row is MonthlyFreightBarcodeOrderLine => Boolean(row))
    .filter((row) => row.cycleMonth === cycleMonth)
    .filter((row) => {
      const key = `${row.draftId}\u0000${row.barcode}\u0000${row.orderNumber}\u0000${row.orderedQuantity}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) =>
      left.orderNumber.localeCompare(right.orderNumber) ||
      left.barcode.localeCompare(right.barcode),
    );

  return {
    cycleMonth,
    lineCount: rows.length,
    orderCount: new Set(rows.map((row) => row.orderNumber).filter(Boolean)).size,
    totalQuantity: rows.reduce((sum, row) => sum + row.orderedQuantity, 0),
    lines: rows,
  };
}
