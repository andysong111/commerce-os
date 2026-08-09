import { PageHeader } from "@/components/PageHeader";
import { loadFastPurchaseMvp, type FastPurchaseMvpAction } from "@/lib/fastPurchaseMvp";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

const number = new Intl.NumberFormat("ko-KR");

function tone(action: FastPurchaseMvpAction) {
  if (action === "ORDER_REVIEW") return "border-blue-200 bg-blue-50 text-blue-900";
  if (action === "FALLBACK_ORDER_REVIEW") return "border-violet-200 bg-violet-50 text-violet-900";
  if (action === "MANUAL_REVIEW") return "border-amber-200 bg-amber-50 text-amber-900";
  if (action === "DEMAND_ONLY_REVIEW") return "border-orange-200 bg-orange-50 text-orange-900";
  if (action === "HOLD") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (action === "FALLBACK_HOLD") return "border-teal-200 bg-teal-50 text-teal-900";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function qty(value: number | null) {
  return value === null ? "-" : number.format(value);
}

function positiveAction(action: FastPurchaseMvpAction) {
  return action === "ORDER_REVIEW" || action === "FALLBACK_ORDER_REVIEW";
}

export default async function FastPurchaseMvpPage() {
  const report = await loadFastPurchaseMvp();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · FAST PURCHASE MVP V2.1"
        title="빠른 발주안 · MVP"
        description="완벽한 초기재고를 기다리지 않습니다. 재고증거가 있는 상품은 시스템이 보수적으로 판단하고, 재고증거가 없는 기존 발주후보도 숨기지 않고 재고 0 가정의 수요 참고수량과 함께 수동 검토목록으로 보여줍니다."
      />

      <section className={`rounded-2xl border p-5 shadow-sm ${report.state === "READY_MVP" ? "border-blue-200 bg-blue-50" : "border-rose-200 bg-rose-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-slate-500">FAST USE · PROVISIONAL V2.1 · SPEED FIRST</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{report.state}</h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">수동 발주만 · 자동주문 0</strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{report.message}</p>
        <p className="mt-2 text-xs text-slate-500">{new Date(report.generatedAt).toLocaleString("ko-KR")} · {report.mode}</p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-9">
        <Metric label="평가·검토 상품" value={number.format(report.evaluatedCount)} />
        <Metric label="시스템 판단" value={number.format(report.systemDecisionCount)} emphasized />
        <Metric label="수동 판단재료" value={number.format(report.manualTriageCount)} emphasized />
        <Metric label="운영 커버리지" value={number.format(report.operationalCoverageCount)} emphasized />
        <Metric label="발주 검토" value={number.format(report.orderReviewCount)} />
        <Metric label="발주 보류" value={number.format(report.holdCount)} />
        <Metric label="상한편향 판정" value={number.format(report.fallbackDecisionCount)} />
        <Metric label="수요만 검토" value={number.format(report.demandOnlyReviewCount)} />
        <Metric label="데이터 보류" value={number.format(report.dataHoldCount)} />
      </section>

      <section className="rounded-2xl border border-violet-200 bg-violet-50 p-5 text-sm leading-6 text-violet-950">
        <strong>두 종류의 절충을 구분합니다.</strong><br />
        `CUMULATIVE_UPPER_BIASED`는 실제재고를 높게 잡아 과잉발주보다 발주 지연 위험을 택하는 시스템 판정입니다. `DEMAND_ONLY_ZERO_STOCK_REFERENCE`는 재고증거가 없어서 시스템이 주문수량을 정하지 않고, 기존 발주엔진이 재고 0으로 계산한 수량만 **참고상한**으로 보여주는 수동 판단재료입니다. 참고상한을 그대로 주문하면 과잉발주가 될 수 있으므로 실제 주문수량으로 자동 사용하지 않습니다.
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-black text-slate-950">오늘 사용할 발주 판단·검토표</h2>
          <p className="mt-1 text-sm text-slate-500">
            파란색·보라색 발주 검토만 시스템 권장수량이 있습니다. 주황색 `수요만 수동검토`의 수량은 주문수량이 아니라 재고 0 가정 참고수량입니다.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1750px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs font-bold text-slate-500">
              <tr>
                <th className="px-3 py-3">판정</th>
                <th className="px-3 py-3">근거</th>
                <th className="px-3 py-3">위험편향</th>
                <th className="px-3 py-3">B-code</th>
                <th className="px-3 py-3">모델번호</th>
                <th className="px-3 py-3">상품</th>
                <th className="px-3 py-3 text-right">MVP 주문검토수량</th>
                <th className="px-3 py-3 text-right">재고0 수요참고</th>
                <th className="px-3 py-3 text-right">임시 계획재고</th>
                <th className="px-3 py-3 text-right">추정재고 낮음</th>
                <th className="px-3 py-3 text-right">추정재고 높음</th>
                <th className="px-3 py-3 text-right">낮은재고 시 발주</th>
                <th className="px-3 py-3 text-right">높은재고 시 발주</th>
                <th className="px-3 py-3">이유</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.rows.length ? report.rows.map((row) => (
                <tr key={row.barcode} className="align-top">
                  <td className="px-3 py-4">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${tone(row.action)}`}>{row.actionLabel}</span>
                  </td>
                  <td className="px-3 py-4 font-mono text-[11px] font-black text-slate-700">{row.basis}</td>
                  <td className="px-3 py-4 font-mono text-[11px] text-slate-500">{row.riskBias}</td>
                  <td className="px-3 py-4 font-mono font-black text-slate-950">{row.barcode}</td>
                  <td className="px-3 py-4 font-mono text-slate-600">{row.modelNo ?? "-"}</td>
                  <td className="px-3 py-4 font-bold text-slate-900">{row.productName}</td>
                  <td className={`px-3 py-4 text-right text-lg font-black ${positiveAction(row.action) ? "text-blue-700" : "text-slate-500"}`}>
                    {number.format(row.recommendedQuantity)}
                  </td>
                  <td className={`px-3 py-4 text-right font-black ${row.action === "DEMAND_ONLY_REVIEW" ? "text-orange-700" : "text-slate-500"}`}>
                    {number.format(row.referenceDemandQuantity)}
                  </td>
                  <td className="px-3 py-4 text-right font-black text-violet-800">{qty(row.planningInventoryQuantity)}</td>
                  <td className="px-3 py-4 text-right">{qty(row.inventoryBandLow)}</td>
                  <td className="px-3 py-4 text-right">{qty(row.inventoryBandHigh)}</td>
                  <td className="px-3 py-4 text-right">{qty(row.lowScenarioRecommendedQuantity)}</td>
                  <td className="px-3 py-4 text-right">{qty(row.highScenarioRecommendedQuantity)}</td>
                  <td className="px-3 py-4 text-xs leading-5 text-slate-500">{row.reason}</td>
                </tr>
              )) : (
                <tr><td colSpan={14} className="px-3 py-10 text-center text-slate-500">현재 표시할 MVP 발주 판단이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        <strong>오늘부터 쓰는 방식</strong><br />
        `발주 검토`·`보수적 발주 검토`는 표시 수량을 실제 주문 후보로 검토합니다. `발주 보류`·`보수적 발주 보류`는 오늘 주문하지 않습니다. `수동 검토`와 `수요만 수동검토`는 사용자가 상품을 보고 재고가 충분한지 대략 판단하는 구간입니다. 특히 주황색 참고수량은 그대로 주문하지 않습니다. 이 화면은 Product Master 재고를 VERIFIED로 바꾸거나 중국 주문·결제를 자동 실행하지 않습니다.
      </section>

      <p className="break-all text-xs text-slate-400">Fingerprint · {report.fingerprint}</p>
    </div>
  );
}

function Metric({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <article className={`rounded-xl border bg-white p-4 ${emphasized ? "border-blue-300" : "border-slate-200"}`}>
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className={`mt-1 block text-xl ${emphasized ? "text-blue-700" : "text-slate-950"}`}>{value}</strong>
    </article>
  );
}
