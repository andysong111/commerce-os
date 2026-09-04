import Link from "next/link";
import { InternalChinaCashEnvelopePanel } from "@/components/china-order-manager/InternalChinaCashEnvelopePanel";
import { PageHeader } from "@/components/PageHeader";
import { loadInternalChinaMonthlyPurchaseClose } from "@/lib/internalChinaMonthlyPurchaseClose";
import { loadInternalChinaMonthlyPurchaseSummary } from "@/lib/internalChinaMonthlyPurchaseSummary";
import {
  koreanMonthLabel,
  previousCalendarMonth,
  seoulCalendarMonth,
} from "@/lib/monthlyPurchasePolicy";
import { loadCalendarMonthNormalRevenue } from "@/lib/shopling/calendarMonthRevenue";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

const money = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

export default async function CashEnvelopePurchasePage() {
  const currentCycleMonth = seoulCalendarMonth(new Date());
  const budgetMonth = previousCalendarMonth(currentCycleMonth);
  const [revenueResult, purchase, monthlyClose] = await Promise.all([
    loadCalendarMonthNormalRevenue(budgetMonth)
      .then((value) => ({ revenueKrw: Math.max(0, Math.round(value.revenueKrw)), error: "" }))
      .catch((error) => ({
        revenueKrw: 0,
        error: error instanceof Error ? error.message : "MONTHLY_BUDGET_UNAVAILABLE",
      })),
    loadInternalChinaMonthlyPurchaseSummary(currentCycleMonth).catch(() => null),
    loadInternalChinaMonthlyPurchaseClose(currentCycleMonth).catch(() => null),
  ]);
  const maxGrossBudgetKrw = Math.round(revenueResult.revenueKrw / 2);
  const recorded1688SpendKrw =
    purchase?.actualOrderPaidKrwAtInternalFx ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="COMMERCE OS · CASH-CONSTRAINED PURCHASE"
        title="현금 제약 발주"
        description="전체 지출가능금액은 그대로 두고, 지금 실제로 추가 발주에 투입할 수 있는 현금만 입력합니다. 기존 발주 추천·소량 검토·점수·MOQ·박스입수·최소주문금액 순서를 그대로 사용해 현금 안에서만 수량을 줄입니다."
        actions={
          <Link
            href="/fast-purchase-mvp"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50"
          >
            기존 빠른 발주안 보기
          </Link>
        }
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <span className="text-[11px] font-bold text-slate-500">발주월</span>
          <strong className="mt-1 block text-lg font-black text-slate-950">
            {koreanMonthLabel(currentCycleMonth)}
          </strong>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">
            현금 입력은 현재 발주월에만 적용
          </p>
        </article>
        <article className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <span className="text-[11px] font-bold text-slate-500">전체 지출가능금액</span>
          <strong className="mt-1 block text-lg font-black text-slate-950">
            {maxGrossBudgetKrw > 0 ? `${money.format(maxGrossBudgetKrw)}원` : "조회 대기"}
          </strong>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">
            {koreanMonthLabel(budgetMonth)} 정상매출 ÷ 2
          </p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="text-[11px] font-bold text-slate-500">발주 상태</span>
          <strong className="mt-1 block text-lg font-black text-slate-950">
            {monthlyClose ? "발주 마감" : "발주 열림"}
          </strong>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">
            {monthlyClose
              ? "계산은 미리보기만 가능 · 기존 주문/입고 원장 불변"
              : "계산 후 권장안 검토 · 자동 주문/결제 없음"}
          </p>
        </article>
      </section>

      {revenueResult.error ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
          전체 지출가능금액 조회가 지연됐습니다. {revenueResult.error}
        </section>
      ) : null}

      <InternalChinaCashEnvelopePanel
        cycleMonth={currentCycleMonth}
        currentCycleMonth={currentCycleMonth}
        maxGrossBudgetKrw={maxGrossBudgetKrw}
        recorded1688SpendKrw={recorded1688SpendKrw}
        monthlyClosed={Boolean(monthlyClose)}
      />

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
        <strong className="text-slate-950">이번 단계의 범위</strong>
        <p className="mt-1">
          현금 제약 층만 추가했습니다. 기존 발주 권장안의 수요·재고·점수 계산은 변경하지 않았고, 계산 버튼도 내부 Draft·1688 주문·결제·상품마스터 재고를 변경하지 않습니다. 다음 단계에서 발주 권장안 로직 자체를 별도로 개편합니다.
        </p>
      </section>
    </div>
  );
}
