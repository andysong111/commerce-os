"use client";

import { useEffect, useMemo, useState } from "react";

const money = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

type CashEnvelopeRow = {
  barcode: string;
  modelNo: string | null;
  productName: string;
  originalGroup: string;
  finalGroup: string;
  priorityScore: number;
  baselineQuantity: number;
  allocatedQuantity: number;
  minimumOrderQuantity: number;
  unitCostKrw: number;
  expectedProductCostKrw: number;
  budgetReduced: boolean;
};

type CashEnvelopeReport = {
  generatedAt: string;
  state: "READY" | "BLOCKED";
  message: string;
  cycleMonth: string;
  budgetMonth: string;
  requestedCashKrw: number;
  maxGrossBudgetKrw: number;
  recorded1688SpendKrw: number;
  maxAdditionalGrossBudgetKrw: number;
  effectiveCashKrw: number;
  cashClamped: boolean;
  purchaseCostMultiplier: number;
  productOrderBudgetKrw: number;
  expectedProductSpendKrw: number;
  expectedAllInSpendKrw: number;
  remainingCashKrw: number;
  recommendedSkuCount: number;
  budgetReducedSkuCount: number;
  rows: CashEnvelopeRow[];
  blockers: string[];
};

function digits(value: string) {
  return value.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
}

function monthLabel(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match ? `${Number(match[1])}년 ${Number(match[2])}월` : value;
}

export function InternalChinaCashEnvelopePanel({
  cycleMonth,
  currentCycleMonth,
  maxGrossBudgetKrw,
  recorded1688SpendKrw,
  monthlyClosed,
}: {
  cycleMonth: string;
  currentCycleMonth: string;
  maxGrossBudgetKrw: number;
  recorded1688SpendKrw: number;
  monthlyClosed: boolean;
}) {
  const currentMonth = cycleMonth === currentCycleMonth;
  const storageKey = `commerceOs.cashEnvelope.${cycleMonth}`;
  const [cashInput, setCashInput] = useState(() => {
    if (typeof window === "undefined" || !currentMonth) return "";
    try {
      return digits(window.localStorage.getItem(storageKey) ?? "");
    } catch {
      return "";
    }
  });
  const [report, setReport] = useState<CashEnvelopeReport | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const maxAdditionalGrossBudgetKrw = Math.max(
    0,
    maxGrossBudgetKrw - recorded1688SpendKrw,
  );

  useEffect(() => {
    if (!currentMonth) return;
    try {
      if (cashInput) window.localStorage.setItem(storageKey, cashInput);
      else window.localStorage.removeItem(storageKey);
    } catch {
      // Local persistence is optional; calculation remains available.
    }
  }, [cashInput, currentMonth, storageKey]);

  const parsedCash = Number(cashInput || 0);
  const inputOverLimit = parsedCash > maxAdditionalGrossBudgetKrw;
  const recommendations = useMemo(
    () => report?.rows.filter((row) => row.allocatedQuantity > 0) ?? [],
    [report],
  );

  const calculate = async () => {
    setNotice("");
    setReport(null);
    if (!currentMonth) {
      setNotice("과거 발주월은 현재 판매·재고 기준으로 다시 계산하지 않습니다.");
      return;
    }
    if (!Number.isFinite(parsedCash) || parsedCash <= 0) {
      setNotice("현재 추가 발주에 실제 투입 가능한 현금을 입력하세요.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/fast-purchase/cash-envelope", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ cashKrw: parsedCash }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        report?: CashEnvelopeReport;
      };
      if (payload.report) {
        setReport(payload.report);
        if (payload.report.state !== "READY") {
          setNotice(payload.report.message);
        }
      } else if (!response.ok || !payload.ok) {
        setNotice(payload.message || "현금 제약 발주안을 계산하지 못했습니다.");
      }
    } catch {
      setNotice("현금 제약 발주안 계산 요청이 일시적으로 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-amber-300 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-amber-700">
            CASH ENVELOPE · EXISTING PURCHASE LOGIC
          </span>
          <h2 className="mt-1 text-xl font-black text-slate-950">
            현금 제약 발주
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">
            전체 지출가능금액은 사업상 상한으로 유지하고, 현재 실제로 추가 발주에
            투입할 수 있는 현금만 입력합니다. 기존 발주 추천 → 소량 검토 → 점수
            순서와 MOQ·박스입수·최소주문금액 규칙은 변경하지 않습니다.
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1.5 text-xs font-black ${
            monthlyClosed
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          {monthlyClosed ? "발주 마감 · 미리보기만" : "발주 열림"}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Metric
          label="전체 지출가능금액"
          value={`${money.format(maxGrossBudgetKrw)}원`}
          note="직전 달력월 정상매출 ÷ 2"
        />
        <Metric
          label="이미 기록된 1688 결제"
          value={`${money.format(recorded1688SpendKrw)}원`}
          note="상품 + 중국내운임 + 서비스비"
        />
        <Metric
          label="현재 추가 지출가능 상한"
          value={`${money.format(maxAdditionalGrossBudgetKrw)}원`}
          note="최종 배송대행 비용 확정 전 기준"
          emphasized
        />
      </div>

      <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
        <label className="block text-sm font-black text-amber-950">
          현재 추가 발주에 실제 투입 가능한 현금
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <input
              inputMode="numeric"
              value={cashInput ? money.format(Number(cashInput)) : ""}
              onChange={(event) => setCashInput(digits(event.target.value))}
              placeholder="예: 1,500,000"
              disabled={!currentMonth}
              className="w-full rounded-xl border border-amber-300 bg-white px-4 py-3 pr-12 text-right text-lg font-black text-slate-950 outline-none focus:border-amber-500 disabled:bg-slate-100 disabled:text-slate-400"
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-500">
              원
            </span>
          </div>
          <button
            type="button"
            onClick={calculate}
            disabled={!currentMonth || loading || parsedCash <= 0}
            className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {loading ? "기존 발주로직 계산 중..." : "현금 기준 발주 권장안 계산"}
          </button>
        </div>
        <p className="mt-2 text-xs leading-5 text-amber-900">
          {currentMonth
            ? inputOverLimit
              ? `입력액이 현재 추가 지출가능 상한 ${money.format(maxAdditionalGrossBudgetKrw)}원을 넘습니다. 계산 시 상한까지만 자동 적용합니다.`
              : "입력값은 계산용입니다. 이 버튼만으로 내부 Draft·1688 주문·결제는 생성되지 않습니다."
            : `${monthLabel(cycleMonth)}은 과거 월이므로 현재 데이터로 재계산하지 않습니다.`}
        </p>
      </div>

      {notice ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-950">
          {notice}
        </div>
      ) : null}

      {report?.state === "READY" ? (
        <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="text-xs font-black tracking-[0.12em] text-blue-700">
                CASH-CONSTRAINED RESULT
              </span>
              <h3 className="mt-1 text-lg font-black text-slate-950">
                기존 로직 기준 현금 제약 권장안
              </h3>
              <p className="mt-1 text-xs leading-5 text-slate-600">{report.message}</p>
            </div>
            <span className="rounded-full border border-blue-300 bg-white px-3 py-1.5 text-xs font-black text-blue-800">
              권장 {report.recommendedSkuCount} SKU
            </span>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <ResultMetric
              label="적용 현금"
              value={`${money.format(report.effectiveCashKrw)}원`}
            />
            <ResultMetric
              label="상품대금 안전한도"
              value={`${money.format(report.productOrderBudgetKrw)}원`}
            />
            <ResultMetric
              label="예상 상품대금"
              value={`${money.format(report.expectedProductSpendKrw)}원`}
            />
            <ResultMetric
              label={`예상 총비용 · ×${report.purchaseCostMultiplier.toFixed(2)}`}
              value={`${money.format(report.expectedAllInSpendKrw)}원`}
            />
            <ResultMetric
              label="예상 잔여현금"
              value={`${money.format(report.remainingCashKrw)}원`}
            />
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-blue-200 bg-white">
            <table className="min-w-[900px] text-left text-xs">
              <thead className="bg-blue-50 font-bold text-slate-500">
                <tr>
                  <th className="px-3 py-3">우선</th>
                  <th className="px-3 py-3">B-code / 상품</th>
                  <th className="px-3 py-3">기존 판정</th>
                  <th className="px-3 py-3 text-right">기존 권장</th>
                  <th className="px-3 py-3 text-right">현금 적용수량</th>
                  <th className="px-3 py-3 text-right">예상 상품대금</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recommendations.slice(0, 30).map((row, index) => (
                  <tr key={row.barcode}>
                    <td className="px-3 py-3 font-black text-blue-700">
                      {index + 1}
                    </td>
                    <td className="px-3 py-3">
                      <strong className="font-mono text-slate-950">{row.barcode}</strong>
                      <span className="ml-2 text-slate-500">
                        {row.modelNo ? `${row.modelNo} · ` : ""}{row.productName}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-bold text-slate-700">
                      {row.originalGroup}
                    </td>
                    <td className="px-3 py-3 text-right text-slate-600">
                      {money.format(row.baselineQuantity)}
                    </td>
                    <td className="px-3 py-3 text-right font-black text-blue-700">
                      {money.format(row.allocatedQuantity)}
                    </td>
                    <td className="px-3 py-3 text-right font-bold text-slate-950">
                      {money.format(row.expectedProductCostKrw)}원
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {recommendations.length > 30 ? (
            <p className="mt-2 text-xs text-slate-500">
              상위 30개만 표시했습니다. 전체 권장 SKU는 {recommendations.length}개입니다.
            </p>
          ) : null}
          <p className="mt-3 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold leading-5 text-blue-950">
            현재 단계는 현금 한도만 기존 발주 로직에 추가한 것입니다. 발주 권장안의 점수·수요·재고 판단 로직 자체는 다음 개편 단계에서 별도로 다룹니다.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function Metric({
  label,
  value,
  note,
  emphasized = false,
}: {
  label: string;
  value: string;
  note: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        emphasized ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"
      }`}
    >
      <span className="text-[11px] font-bold text-slate-500">{label}</span>
      <strong className="mt-1 block text-lg font-black text-slate-950">{value}</strong>
      <p className="mt-1 text-[11px] leading-5 text-slate-500">{note}</p>
    </div>
  );
}

function ResultMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-blue-200 bg-white p-3">
      <span className="text-[11px] font-bold text-slate-500">{label}</span>
      <strong className="mt-1 block text-base font-black text-slate-950">{value}</strong>
    </div>
  );
}
