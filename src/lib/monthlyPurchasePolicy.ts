import {
  normalizeShoplingOrder,
  type ShoplingRawRow,
} from "./shopling/shoplingNormalize.ts";

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

export const PURCHASE_RECOMMENDATION_CADENCE = "MONTHLY" as const;
export const PRICE_GRADE_CADENCE = "DAILY" as const;

function asDate(value: Date | string) {
  const date = value instanceof Date ? new Date(value.valueOf()) : new Date(value);
  if (!Number.isFinite(date.valueOf())) {
    throw new Error("MONTHLY_PURCHASE_DATE_INVALID");
  }
  return date;
}

export function seoulCalendarMonth(value: Date | string = new Date()) {
  return new Date(asDate(value).valueOf() + SEOUL_OFFSET_MS)
    .toISOString()
    .slice(0, 7);
}

export function previousCalendarMonth(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("MONTHLY_PURCHASE_MONTH_INVALID");
  }
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return date.toISOString().slice(0, 7);
}

export function calendarMonthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("MONTHLY_PURCHASE_MONTH_INVALID");
  }
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function monthlyPurchaseCycleFor(
  value: Date | string = new Date(),
) {
  const cycleMonth = seoulCalendarMonth(value);
  const budgetMonth = previousCalendarMonth(cycleMonth);
  return {
    cycleMonth,
    budgetMonth,
    budgetRange: calendarMonthRange(budgetMonth),
  };
}

export function koreanMonthLabel(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  const [year, monthNumber] = month.split("-");
  return `${Number(year)}년 ${Number(monthNumber)}월`;
}

export function validNormalSaleStatus(status: string) {
  const normalized = status.toLowerCase();
  return !["취소", "반품", "환불", "cancel", "return", "refund"].some(
    (keyword) => normalized.includes(keyword),
  );
}

export function calendarMonthNormalRevenue(
  rows: ShoplingRawRow[],
  month: string,
) {
  const seen = new Set<string>();
  let revenue = 0;
  for (const raw of rows) {
    const order = normalizeShoplingOrder(raw);
    if (!order.id || seen.has(order.id)) continue;
    seen.add(order.id);
    if (!order.orderNo || !validNormalSaleStatus(order.status)) continue;
    if (!order.orderedAt.slice(0, 7).startsWith(month)) continue;
    revenue += Math.max(0, Number(order.paidAmount) || 0);
  }
  return Math.round(revenue);
}
