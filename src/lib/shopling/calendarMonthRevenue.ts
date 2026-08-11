import {
  calendarMonthNormalRevenue,
  calendarMonthRange,
} from "@/lib/monthlyPurchasePolicy";
import {
  ShoplingReadClient,
  shoplingReadConfigFromEnv,
  splitShoplingDateRange,
} from "@/lib/shopling/shoplingReadClient";
import {
  createSupabaseAdminClient,
  createSupabaseAdminHeaders,
} from "@/lib/supabase/admin";

export const SHOPLING_CALENDAR_MONTH_REVENUE_OPERATION =
  "SHOPLING_CALENDAR_MONTH_REVENUE";

function shoplingEnvironment() {
  return {
    SHOPLING_LOGIN_ID: process.env.SHOPLING_LOGIN_ID,
    SHOPLING_COMPANY_ID: process.env.SHOPLING_COMPANY_ID,
    SHOPLING_API_AUTH_KEY: process.env.SHOPLING_API_AUTH_KEY,
    SHOPLING_PRODUCTS_API_URL: process.env.SHOPLING_PRODUCTS_API_URL,
    SHOPLING_ORDERS_API_URL: process.env.SHOPLING_ORDERS_API_URL,
    SHOPLING_CLAIMS_API_URL: process.env.SHOPLING_CLAIMS_API_URL,
  };
}

function sourceEventId(month: string) {
  return `shopling-calendar-month-revenue:${month}`;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonnegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

async function readCached(month: string) {
  const admin = await createSupabaseAdminClient();
  if (!admin) return null;
  const result = await admin
    .from("commerce_operation_runs")
    .select("result_snapshot,started_at")
    .eq("operation_type", SHOPLING_CALENDAR_MONTH_REVENUE_OPERATION)
    .eq("source_event_id", sourceEventId(month))
    .eq("status", "SUCCEEDED")
    .maybeSingle();
  if (result.error || !result.data || typeof result.data !== "object") {
    return null;
  }
  const row = result.data as {
    result_snapshot?: unknown;
    started_at?: unknown;
  };
  const snapshot = object(row.result_snapshot);
  if (String(snapshot.month ?? "") !== month) return null;
  const revenueKrw = nonnegativeInteger(snapshot.revenueKrw);
  const range = calendarMonthRange(month);
  return {
    month,
    range,
    revenueKrw,
    fetchedRows: nonnegativeInteger(snapshot.fetchedRows),
    chunkCount: nonnegativeInteger(snapshot.chunkCount),
    cached: true,
    frozenAt: String(snapshot.frozenAt ?? row.started_at ?? "") || null,
  };
}

async function storeCached(input: {
  month: string;
  range: { start: string; end: string };
  revenueKrw: number;
  fetchedRows: number;
  chunkCount: number;
}) {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) return;
  const now = new Date().toISOString();
  await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=source_event_id`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          operation_type: SHOPLING_CALENDAR_MONTH_REVENUE_OPERATION,
          status: "SUCCEEDED",
          source: "shopling-read-api",
          source_event_id: sourceEventId(input.month),
          correlation_id: `monthly-purchase-budget:${input.month}`,
          actor_type: "OPS_WORKER",
          input_snapshot: {
            month: input.month,
            range: input.range,
          },
          result_snapshot: {
            ...input,
            frozenAt: now,
            calendarMonthFrozen: true,
          },
          error_message: null,
          started_at: now,
          finished_at: now,
          updated_at: now,
        },
      ]),
      cache: "no-store",
    },
  ).catch(() => null);
}

/**
 * A closed calendar month is read once from Shopling and then frozen in the
 * Ops ledger. This prevents the same purchase cycle from drifting because of
 * later current-month sales or repeated page refreshes.
 */
export async function loadCalendarMonthNormalRevenue(month: string) {
  const cached = await readCached(month);
  if (cached) return cached;

  const range = calendarMonthRange(month);
  const config = shoplingReadConfigFromEnv(shoplingEnvironment());
  const client = new ShoplingReadClient(config);
  const chunks = splitShoplingDateRange(range.start, range.end, 7);
  let revenueKrw = 0;
  let fetchedRows = 0;
  for (const chunk of chunks) {
    const rows = await client.read("orders", chunk);
    fetchedRows += rows.length;
    revenueKrw += calendarMonthNormalRevenue(rows, month);
  }
  const result = {
    month,
    range,
    revenueKrw: Math.max(0, Math.round(revenueKrw)),
    fetchedRows,
    chunkCount: chunks.length,
    cached: false,
    frozenAt: new Date().toISOString(),
  };
  await storeCached(result);
  return result;
}
