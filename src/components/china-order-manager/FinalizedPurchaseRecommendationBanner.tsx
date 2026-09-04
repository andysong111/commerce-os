"use client";

import { useEffect, useMemo, useState } from "react";

type FinalizedRow = {
  barcode: string;
  modelNo: string | null;
  productName: string;
  pattern: string;
  allocatedQuantity: number;
  expectedProductCostKrw: number;
  priorityScore: number;
};

type FinalizedSnapshot = {
  finalizationId: string;
  cycleMonth: string;
  finalizedAt: string;
  effectiveCashKrw: number;
  expectedProductSpendKrw: number;
  expectedAllInSpendKrw: number;
  calculationFingerprint: string;
  ruleVersion: string;
  rows: FinalizedRow[];
};

const money = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

function patternLabel(value: string) {
  if (value === "GROWTH") return "성장형";
  if (value === "STABLE_CORE") return "핵심 안정형";
  if (value === "DECLINING") return "하락형";
  if (value === "DORMANT") return "휴면";
  return "일반형";
}

export function FinalizedPurchaseRecommendationBanner() {
  const [snapshot, setSnapshot] = useState<FinalizedSnapshot | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/fast-purchase/finalized", {
      cache: "no-store",
      headers: { accept: "application/json" },
    })
      .then((response) => response.json())
      .then((payload: { snapshot?: FinalizedSnapshot | null }) => {
        if (!cancelled) setSnapshot(payload.snapshot ?? null);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  const orderRows = useMemo(
    () =>
      (snapshot?.rows ?? [])
        .filter((row) => Number(row.allocatedQuantity) > 0)
        .sort(
          (left, right) =>
            Number(right.priorityScore) - Number(left.priorityScore) ||
            left.barcode.localeCompare(right.barcode, "ko"),
        ),
    [snapshot],
  );

  if (!snapshot) return null;

  return (
    <section
      id="finalized-purchase"
      className="mb-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-emerald-700">
            PURCHASE V2 · BUDGET FINALIZED
          </span>
          <h2 className="mt-1 text-lg font-black text-emerald-950">
            {snapshot.cycleMonth} 확정 발주안 · {orderRows.length} SKU
          </h2>
          <p className="mt-1 text-xs leading-5 text-emerald-900">
            실제 투입현금 {money.format(snapshot.effectiveCashKrw)}원 · 상품대금 {money.format(snapshot.expectedProductSpendKrw)}원 · 예상 총비용 {money.format(snapshot.expectedAllInSpendKrw)}원 · {new Date(snapshot.finalizedAt).toLocaleString("ko-KR")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-xl border border-emerald-300 bg-white px-4 py-2.5 text-sm font-black text-emerald-900"
        >
          {open ? "확정안 접기" : "1688 주문수량 펼치기"}
        </button>
      </div>

      {open ? (
        <div className="mt-4 overflow-x-auto rounded-xl border border-emerald-200 bg-white">
          <table className="min-w-[900px] text-left text-xs">
            <thead className="bg-emerald-50 text-slate-600">
              <tr>
                <th className="px-3 py-3">우선</th>
                <th className="px-3 py-3">B코드 / 상품</th>
                <th className="px-3 py-3">유형</th>
                <th className="px-3 py-3 text-right">확정 주문수량</th>
                <th className="px-3 py-3 text-right">예상 상품대금</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orderRows.map((row, index) => (
                <tr key={row.barcode}>
                  <td className="px-3 py-3 font-black text-emerald-700">{index + 1}</td>
                  <td className="px-3 py-3">
                    <strong className="font-mono text-slate-950">{row.barcode}</strong>
                    <span className="ml-2 text-slate-500">
                      {row.modelNo ? `${row.modelNo} · ` : ""}{row.productName}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-bold text-slate-700">{patternLabel(row.pattern)}</td>
                  <td className="px-3 py-3 text-right text-base font-black text-emerald-700">
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
      ) : null}
      <p className="mt-2 break-all text-[10px] text-emerald-700">
        {snapshot.ruleVersion} · {snapshot.calculationFingerprint}
      </p>
    </section>
  );
}
