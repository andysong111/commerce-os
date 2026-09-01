import type { InternalChinaForwarderCostSummary } from "@/lib/internalChinaForwarderCost";
import { koreanMonthLabel } from "@/lib/monthlyPurchasePolicy";

const number = new Intl.NumberFormat("ko-KR");

function purchaseIncludingChinaFreight(summary: InternalChinaForwarderCostSummary) {
  return summary.productPurchaseCostKrw + summary.domesticChinaFreightKrw;
}

function totalOutflow(summary: InternalChinaForwarderCostSummary) {
  return (
    summary.actualTotalOutflowKrw ??
    purchaseIncludingChinaFreight(summary) + (summary.actualCostKrw ?? 0)
  );
}

function inclusiveMultiplier(summary: InternalChinaForwarderCostSummary) {
  const purchase = purchaseIncludingChinaFreight(summary);
  return purchase > 0 ? totalOutflow(summary) / purchase : null;
}

export function InternalChinaForwarderCloseHistory({
  summaries,
}: {
  summaries: InternalChinaForwarderCostSummary[];
}) {
  if (!summaries.length) return null;
  const latest = summaries[0];
  const purchase = purchaseIncludingChinaFreight(latest);
  const multiplier = inclusiveMultiplier(latest);

  return (
    <section className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-indigo-700">
            RECENT LANDED COST CLOSE
          </span>
          <h2 className="mt-1 text-lg font-black text-slate-950">
            최근 마감 원가 · {koreanMonthLabel(latest.cycleMonth)}
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            월이 바뀌어도 직전 발주의 상품대금·중국내운임·실제 부대비용과 총지출을 계속 확인할 수 있습니다.
          </p>
        </div>
        <span className="rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-black text-indigo-800">
          {latest.closedAt
            ? `마감 ${new Date(latest.closedAt).toLocaleString("ko-KR")}`
            : "마감 완료"}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상품대금" value={`${number.format(latest.productPurchaseCostKrw)}원`} />
        <Metric label="중국내운임" value={`${number.format(latest.domesticChinaFreightKrw)}원`} />
        <Metric
          label="매입금액(중국내운임 포함)"
          value={`${number.format(purchase)}원`}
        />
        <Metric
          label="실제 부대비용"
          value={`${number.format(latest.actualCostKrw ?? 0)}원`}
        />
        <Metric label="실제 총지출" value={`${number.format(totalOutflow(latest))}원`} />
        <Metric
          label="중국내운임 포함 배수"
          value={multiplier === null ? "-" : multiplier.toFixed(4)}
          emphasized
        />
      </div>

      <p className="mt-3 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-xs font-bold leading-5 text-indigo-950">
        표시 배수 = (상품대금 + 중국내운임 + 실제 부대비용) ÷ (상품대금 + 중국내운임). 기존 내부 원가배수 저장값은 변경하지 않고 조회용으로 분리 표시합니다.
      </p>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-[980px] text-left text-xs">
          <thead className="bg-slate-50 font-bold text-slate-500">
            <tr>
              <th className="px-3 py-3">월</th>
              <th className="px-3 py-3 text-right">상품대금</th>
              <th className="px-3 py-3 text-right">중국내운임</th>
              <th className="px-3 py-3 text-right">운임포함 매입금액</th>
              <th className="px-3 py-3 text-right">실제 부대비용</th>
              <th className="px-3 py-3 text-right">총지출</th>
              <th className="px-3 py-3 text-right">운임포함 배수</th>
              <th className="px-3 py-3">마감시각</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {summaries.map((summary) => {
              const rowPurchase = purchaseIncludingChinaFreight(summary);
              const rowMultiplier = inclusiveMultiplier(summary);
              return (
                <tr key={summary.draftId}>
                  <td className="px-3 py-3 font-black text-slate-950">
                    {koreanMonthLabel(summary.cycleMonth)}
                  </td>
                  <td className="px-3 py-3 text-right">{number.format(summary.productPurchaseCostKrw)}원</td>
                  <td className="px-3 py-3 text-right">{number.format(summary.domesticChinaFreightKrw)}원</td>
                  <td className="px-3 py-3 text-right font-bold">{number.format(rowPurchase)}원</td>
                  <td className="px-3 py-3 text-right">{number.format(summary.actualCostKrw ?? 0)}원</td>
                  <td className="px-3 py-3 text-right font-bold">{number.format(totalOutflow(summary))}원</td>
                  <td className="px-3 py-3 text-right font-black text-indigo-700">
                    {rowMultiplier === null ? "-" : rowMultiplier.toFixed(4)}
                  </td>
                  <td className="px-3 py-3 text-slate-500">
                    {summary.closedAt
                      ? new Date(summary.closedAt).toLocaleString("ko-KR")
                      : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <article
      className={`rounded-xl border bg-white p-3 ${
        emphasized ? "border-indigo-300" : "border-slate-200"
      }`}
    >
      <p className="text-[11px] font-bold text-slate-500">{label}</p>
      <strong
        className={`mt-1 block break-words text-base font-black ${
          emphasized ? "text-indigo-700" : "text-slate-950"
        }`}
      >
        {value}
      </strong>
    </article>
  );
}
