import { PageHeader } from "@/components/PageHeader";
import { loadFastPurchaseMvp, type FastPurchaseMvpAction } from "@/lib/fastPurchaseMvp";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

const number = new Intl.NumberFormat("ko-KR");

function tone(action: FastPurchaseMvpAction) {
  if (action === "ORDER_REVIEW") return "border-blue-200 bg-blue-50 text-blue-900";
  if (action === "MANUAL_REVIEW") return "border-amber-200 bg-amber-50 text-amber-900";
  if (action === "HOLD") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function qty(value: number | null) {
  return value === null ? "-" : number.format(value);
}

export default async function FastPurchaseMvpPage() {
  const report = await loadFastPurchaseMvp();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · FAST PURCHASE MVP"
        title="빠른 발주안 · MVP"
        description="재고 전수조사를 기다리지 않고 현재 확보된 판매·과거발주·추정재고 밴드로 오늘 바로 쓸 수 있는 발주 검토표를 만듭니다. 불확실한 상품은 억지로 결론내지 않고 보류합니다."
      />

      <section className={`rounded-2xl border p-5 shadow-sm ${report.state === "READY_MVP" ? "border-blue-200 bg-blue-50" : "border-rose-200 bg-rose-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-slate-500">FAST USE · PROVISIONAL V1</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{report.state}</h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">수동 발주만 · 자동주문 0</strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{report.message}</p>
        <p className="mt-2 text-xs text-slate-500">{new Date(report.generatedAt).toLocaleString("ko-KR")} · {report.mode}</p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="평가 상품" value={number.format(report.evaluatedCount)} />
        <Metric label="오늘 판단 가능" value={number.format(report.usableDecisionCount)} />
        <Metric label="발주 검토" value={number.format(report.orderReviewCount)} emphasized />
        <Metric label="발주 보류" value={number.format(report.holdCount)} />
        <Metric label="수동 검토" value={number.format(report.manualReviewCount)} />
        <Metric label="데이터 보류" value={number.format(report.dataHoldCount)} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-black text-slate-950">오늘 사용할 발주 판단표</h2>
          <p className="mt-1 text-sm text-slate-500">
            발주 검토는 추정재고가 낮은 경우와 높은 경우 모두 발주가 필요한 상품만 표시합니다. 수량은 두 시나리오 중 더 작은 권장수량입니다.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1300px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs font-bold text-slate-500">
              <tr>
                <th className="px-3 py-3">판정</th>
                <th className="px-3 py-3">B-code</th>
                <th className="px-3 py-3">모델번호</th>
                <th className="px-3 py-3">상품</th>
                <th className="px-3 py-3 text-right">MVP 권장수량</th>
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
                  <td className="px-3 py-4 font-mono font-black text-slate-950">{row.barcode}</td>
                  <td className="px-3 py-4 font-mono text-slate-600">{row.modelNo ?? "-"}</td>
                  <td className="px-3 py-4 font-bold text-slate-900">{row.productName}</td>
                  <td className={`px-3 py-4 text-right text-lg font-black ${row.action === "ORDER_REVIEW" ? "text-blue-700" : "text-slate-500"}`}>
                    {number.format(row.recommendedQuantity)}
                  </td>
                  <td className="px-3 py-4 text-right">{qty(row.inventoryBandLow)}</td>
                  <td className="px-3 py-4 text-right">{qty(row.inventoryBandHigh)}</td>
                  <td className="px-3 py-4 text-right">{qty(row.lowScenarioRecommendedQuantity)}</td>
                  <td className="px-3 py-4 text-right">{qty(row.highScenarioRecommendedQuantity)}</td>
                  <td className="px-3 py-4 text-xs leading-5 text-slate-500">{row.reason}</td>
                </tr>
              )) : (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-slate-500">현재 표시할 MVP 발주 판단이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        <strong>이번 절충안의 운영 규칙</strong><br />
        `발주 검토`만 실제 발주 후보로 사용하고, `수동 검토`와 `데이터 보류`는 주문하지 않습니다. `발주 보류`는 주문하지 않는 판단으로 바로 사용할 수 있습니다. 이 화면은 Product Master 재고를 VERIFIED로 바꾸지 않고 중국 Draft/결제도 자동 실행하지 않습니다. 실제 입고가 쌓이면 이후 정확도만 점진적으로 높입니다.
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
