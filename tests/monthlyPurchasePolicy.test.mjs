import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PRICE_GRADE_CADENCE,
  PURCHASE_RECOMMENDATION_CADENCE,
  calendarMonthNormalRevenue,
  calendarMonthRange,
  monthlyPurchaseCycleFor,
} from "../src/lib/monthlyPurchasePolicy.ts";

const [liveRoute, liveControl, fastDraft, canonicalShadow, scheduler] =
  await Promise.all([
    readFile("src/app/api/product-decision-agent/live-refresh/route.ts", "utf8"),
    readFile(
      "src/app/product-decision-agent/live-refresh/LiveRefreshControl.tsx",
      "utf8",
    ),
    readFile("src/lib/fastPurchaseInternalDraft.ts", "utf8"),
    readFile("src/lib/stage8CanonicalPurchaseShadow.ts", "utf8"),
    readFile(
      "supabase/migrations/202608280009_ops_adaptive_dispatcher.sql",
      "utf8",
    ),
  ]);

test("purchase cycle follows Seoul calendar month and budgets from the prior full month", () => {
  const august = monthlyPurchaseCycleFor("2026-08-11T17:32:00+09:00");
  assert.equal(august.cycleMonth, "2026-08");
  assert.equal(august.budgetMonth, "2026-07");
  assert.deepEqual(august.budgetRange, {
    start: "2026-07-01",
    end: "2026-07-31",
  });

  const march = monthlyPurchaseCycleFor("2026-03-05T09:00:00+09:00");
  assert.equal(march.budgetMonth, "2026-02");
  assert.deepEqual(calendarMonthRange("2026-02"), {
    start: "2026-02-01",
    end: "2026-02-28",
  });
});

test("calendar-month normal revenue excludes other months, cancelled rows and duplicates", () => {
  const rows = [
    {
      ord_no: "O1",
      opt_id: "1",
      mall_ord_seq: "1",
      mall_ord_dt: "20260705120000",
      ord_status: "배송완료",
      mall_ord_cnt: "2",
      mall_unit_price: "10000",
    },
    {
      ord_no: "O1",
      opt_id: "1",
      mall_ord_seq: "1",
      mall_ord_dt: "20260705120000",
      ord_status: "배송완료",
      mall_ord_cnt: "2",
      mall_unit_price: "10000",
    },
    {
      ord_no: "O2",
      opt_id: "2",
      mall_ord_seq: "1",
      mall_ord_dt: "20260710120000",
      ord_status: "주문취소",
      mall_ord_cnt: "1",
      mall_unit_price: "7000",
    },
    {
      ord_no: "O3",
      opt_id: "3",
      mall_ord_seq: "1",
      mall_ord_dt: "20260801120000",
      ord_status: "배송완료",
      mall_ord_cnt: "1",
      mall_unit_price: "9000",
    },
  ];
  assert.equal(calendarMonthNormalRevenue(rows, "2026-07"), 20_000);
});

test("purchase recommendation is monthly while grade and price cadence remains daily", () => {
  assert.equal(PURCHASE_RECOMMENDATION_CADENCE, "MONTHLY");
  assert.equal(PRICE_GRADE_CADENCE, "DAILY");
  assert.match(liveRoute, /loadMonthlyPurchaseCycleGate/);
  assert.match(liveRoute, /monthlyPolicy\.locked/);
  assert.match(liveControl, /monthlyLocked/);
  assert.match(liveControl, /월 1회/);
  assert.match(fastDraft, /FAST_PURCHASE_MONTHLY_CYCLE_ALREADY_USED/);
  assert.match(fastDraft, /draft\.cycleMonth === cycleMonth/);
});

test("operational purchase allocation uses previous calendar-month revenue, not rolling revenue for its funding cap", () => {
  assert.match(canonicalShadow, /loadCalendarMonthNormalRevenue\(cycle\.budgetMonth\)/);
  assert.match(canonicalShadow, /recent30Revenue: purchaseBudgetMonthRevenue/);
  assert.match(canonicalShadow, /budgetBasis:/);
  assert.match(canonicalShadow, /1일~말일 정상매출/);
});

test("daily sales and price-grade pipelines remain independent from the monthly purchase lock", () => {
  for (const task of [
    "product-master-shopling-sales-incremental",
    "product-master-shopling-sales-events",
    "receipt-live-price-proposals",
    "price-grade-receipt-shadow-bootstrap",
  ]) {
    assert.match(scheduler, new RegExp(task));
  }
  assert.match(scheduler, /workload_class in \('critical', 'operational', 'diagnostic', 'maintenance'\)/);
});
