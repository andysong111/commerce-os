import { previousCalendarMonth } from "@/lib/monthlyPurchasePolicy";
import { loadCalendarMonthNormalRevenue } from "@/lib/shopling/calendarMonthRevenue";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

export const INTERNAL_CHINA_FUNDING_CLOSE_OPERATION_TYPE =
  "INTERNAL_CHINA_MONTHLY_FUNDING_CLOSE";

const FORWARDER_OPERATION_TYPE = "INTERNAL_CHINA_FORWARDER_COST_CLOSE";
const SOURCE = "ops-center-internal-china-funding-close";
const DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;
const MAX_KRW = 1_000_000_000;
const MAX_CURRENCY_BALANCE = 1_000_000_000;

export type InternalChinaFundingCloseInput = {
  draftId?: unknown;
  cycleMonth?: unknown;
  worldFirstTransferKrw?: unknown;
  worldFirstEndingUsd?: unknown;
  worldFirstEndingCnh?: unknown;
  koreaAccountSpentKrw?: unknown;
};

export type InternalChinaFundingCloseSummary = {
  draftId: string;
  cycleMonth: string;
  budgetMonth: string;
  budgetMonthRevenueKrw: number;
  totalSpendingBudgetKrw: number;
  worldFirstTransferKrw: number;
  worldFirstEndingUsd: number;
  worldFirstEndingCnh: number;
  koreaAccountAvailableKrw: number;
  koreaAccountSpentKrw: number;
  koreaAccountRemainingKrw: number;
  emergencyReserveTransferKrw: number;
  closedAt: string;
};

type StoredRow = {
  result_snapshot?: unknown;
  started_at?: unknown;
  updated_at?: unknown;
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

function decimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.round(parsed * 100) / 100)
    : 0;
}

function validDraftId(value: unknown) {
  const draftId = text(value);
  if (!DRAFT_ID.test(draftId)) throw new Error("CHINA_FUNDING_CLOSE_DRAFT_INVALID");
  return draftId;
}

function validCycleMonth(value: unknown) {
  const cycleMonth = text(value);
  if (!/^\d{4}-\d{2}$/.test(cycleMonth)) {
    throw new Error("CHINA_FUNDING_CLOSE_CYCLE_MONTH_INVALID");
  }
  return cycleMonth;
}

function validTransferKrw(value: unknown) {
  const amount = integer(value);
  if (amount <= 0) throw new Error("CHINA_FUNDING_CLOSE_WORLDFIRST_TRANSFER_REQUIRED");
  if (amount > MAX_KRW) throw new Error("CHINA_FUNDING_CLOSE_AMOUNT_EXCEEDED");
  return amount;
}

function validKoreaSpentKrw(value: unknown) {
  const amount = integer(value);
  if (amount > MAX_KRW) throw new Error("CHINA_FUNDING_CLOSE_AMOUNT_EXCEEDED");
  return amount;
}

function validCurrencyBalance(value: unknown) {
  const amount = decimal(value);
  if (amount > MAX_CURRENCY_BALANCE) {
    throw new Error("CHINA_FUNDING_CLOSE_BALANCE_EXCEEDED");
  }
  return amount;
}

function forwarderSourceEventId(draftId: string) {
  return `internal-china-forwarder-cost:${draftId}`;
}

function fundingSourceEventId(draftId: string) {
  return `internal-china-monthly-funding-close:${draftId}`;
}

function correlationId(draftId: string) {
  return `internal-china-purchase:${draftId}`;
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

export function parseInternalChinaFundingClose(
  value: unknown,
): InternalChinaFundingCloseSummary | null {
  const row = object(value);
  const draftId = text(row.draftId);
  const cycleMonth = text(row.cycleMonth);
  const budgetMonth = text(row.budgetMonth);
  const closedAt = text(row.closedAt);
  const totalSpendingBudgetKrw = integer(row.totalSpendingBudgetKrw);
  if (
    !DRAFT_ID.test(draftId) ||
    !/^\d{4}-\d{2}$/.test(cycleMonth) ||
    !/^\d{4}-\d{2}$/.test(budgetMonth) ||
    !closedAt ||
    totalSpendingBudgetKrw <= 0
  ) {
    return null;
  }
  return {
    draftId,
    cycleMonth,
    budgetMonth,
    budgetMonthRevenueKrw: integer(row.budgetMonthRevenueKrw),
    totalSpendingBudgetKrw,
    worldFirstTransferKrw: integer(row.worldFirstTransferKrw),
    worldFirstEndingUsd: validCurrencyBalance(row.worldFirstEndingUsd),
    worldFirstEndingCnh: validCurrencyBalance(row.worldFirstEndingCnh),
    koreaAccountAvailableKrw: integer(row.koreaAccountAvailableKrw),
    koreaAccountSpentKrw: integer(row.koreaAccountSpentKrw),
    koreaAccountRemainingKrw: integer(row.koreaAccountRemainingKrw),
    emergencyReserveTransferKrw: integer(row.emergencyReserveTransferKrw),
    closedAt,
  };
}

async function readForwarderClose(draftId: string) {
  const { baseUrl, secret } = supabaseConnection();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?operation_type=eq.${FORWARDER_OPERATION_TYPE}&source_event_id=eq.${encodeURIComponent(forwarderSourceEventId(draftId))}&select=result_snapshot&limit=1`,
    {
      headers: createSupabaseAdminHeaders(secret),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!response.ok) {
    throw new Error(`CHINA_FUNDING_CLOSE_FORWARDER_READ_FAILED:${response.status}`);
  }
  const rows = (await response.json().catch(() => [])) as StoredRow[];
  const snapshot = object(rows[0]?.result_snapshot);
  if (!Object.keys(snapshot).length) {
    throw new Error("CHINA_FUNDING_CLOSE_FORWARDER_REQUIRED");
  }
  return snapshot;
}

async function storeFundingClose(
  fundingClose: InternalChinaFundingCloseSummary,
) {
  const { baseUrl, secret } = supabaseConnection();
  const now = fundingClose.closedAt;
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=source_event_id,result_snapshot,updated_at`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          operation_type: INTERNAL_CHINA_FUNDING_CLOSE_OPERATION_TYPE,
          status: "SUCCEEDED",
          source: SOURCE,
          source_event_id: fundingSourceEventId(fundingClose.draftId),
          correlation_id: correlationId(fundingClose.draftId),
          actor_type: "OPS_OPERATOR",
          input_snapshot: {
            draftId: fundingClose.draftId,
            cycleMonth: fundingClose.cycleMonth,
            worldFirstTransferKrw: fundingClose.worldFirstTransferKrw,
            worldFirstEndingUsd: fundingClose.worldFirstEndingUsd,
            worldFirstEndingCnh: fundingClose.worldFirstEndingCnh,
            koreaAccountSpentKrw: fundingClose.koreaAccountSpentKrw,
          },
          result_snapshot: fundingClose,
          started_at: now,
          finished_at: now,
          updated_at: now,
        },
      ]),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `CHINA_FUNDING_CLOSE_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
    );
  }
}

export async function loadInternalChinaFundingClose(
  draftIdInput: unknown,
): Promise<InternalChinaFundingCloseSummary | null> {
  const draftId = validDraftId(draftIdInput);
  const { baseUrl, secret } = supabaseConnection();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?operation_type=eq.${INTERNAL_CHINA_FUNDING_CLOSE_OPERATION_TYPE}&source_event_id=eq.${encodeURIComponent(fundingSourceEventId(draftId))}&select=result_snapshot,started_at,updated_at&limit=1`,
    {
      headers: createSupabaseAdminHeaders(secret),
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    },
  );
  if (!response.ok) {
    throw new Error(`CHINA_FUNDING_CLOSE_READ_FAILED:${response.status}`);
  }
  const rows = (await response.json().catch(() => [])) as StoredRow[];
  return parseInternalChinaFundingClose(rows[0]?.result_snapshot);
}

export async function recordInternalChinaFundingClose(
  input: InternalChinaFundingCloseInput,
): Promise<InternalChinaFundingCloseSummary> {
  const draftId = validDraftId(input.draftId);
  const cycleMonth = validCycleMonth(input.cycleMonth);
  const worldFirstTransferKrw = validTransferKrw(input.worldFirstTransferKrw);
  const worldFirstEndingUsd = validCurrencyBalance(input.worldFirstEndingUsd);
  const worldFirstEndingCnh = validCurrencyBalance(input.worldFirstEndingCnh);
  const koreaAccountSpentKrw = validKoreaSpentKrw(input.koreaAccountSpentKrw);

  const snapshot = await readForwarderClose(draftId);
  if (text(snapshot.draftId) !== draftId || text(snapshot.cycleMonth) !== cycleMonth) {
    throw new Error("CHINA_FUNDING_CLOSE_FORWARDER_CONFLICT");
  }
  const actualForwarderCostKrw = integer(snapshot.actualCostKrw);
  if (actualForwarderCostKrw <= 0) {
    throw new Error("CHINA_FUNDING_CLOSE_FORWARDER_REQUIRED");
  }
  if (koreaAccountSpentKrw < actualForwarderCostKrw) {
    throw new Error(
      `CHINA_FUNDING_CLOSE_KOREA_SPEND_BELOW_FORWARDER:${actualForwarderCostKrw}`,
    );
  }

  const budgetMonth = previousCalendarMonth(cycleMonth);
  const revenue = await loadCalendarMonthNormalRevenue(budgetMonth);
  const budgetMonthRevenueKrw = integer(revenue.revenueKrw);
  const totalSpendingBudgetKrw = integer(budgetMonthRevenueKrw / 2);
  if (totalSpendingBudgetKrw <= 0) {
    throw new Error("CHINA_FUNDING_CLOSE_BUDGET_UNAVAILABLE");
  }
  if (worldFirstTransferKrw > totalSpendingBudgetKrw) {
    throw new Error("CHINA_FUNDING_CLOSE_WORLDFIRST_TRANSFER_EXCEEDED");
  }

  const koreaAccountAvailableKrw = totalSpendingBudgetKrw - worldFirstTransferKrw;
  if (koreaAccountSpentKrw > koreaAccountAvailableKrw) {
    throw new Error("CHINA_FUNDING_CLOSE_KOREA_SPEND_EXCEEDED");
  }
  const koreaAccountRemainingKrw =
    koreaAccountAvailableKrw - koreaAccountSpentKrw;
  const now = new Date().toISOString();
  const fundingClose: InternalChinaFundingCloseSummary = {
    draftId,
    cycleMonth,
    budgetMonth,
    budgetMonthRevenueKrw,
    totalSpendingBudgetKrw,
    worldFirstTransferKrw,
    worldFirstEndingUsd,
    worldFirstEndingCnh,
    koreaAccountAvailableKrw,
    koreaAccountSpentKrw,
    koreaAccountRemainingKrw,
    emergencyReserveTransferKrw: koreaAccountRemainingKrw,
    closedAt: now,
  };

  await storeFundingClose(fundingClose);
  return fundingClose;
}
