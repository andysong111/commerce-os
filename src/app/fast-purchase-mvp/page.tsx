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
        eyebrow="COMMERCE OS · FAST PURCHASE MVP V2"
        title="빠른 발주안 · MVP"
        description="재고 전수조사를 기다리지 않습니다. 완성된 추정재고 밴드는 그대로 쓰고, 최신 입고증거만 부족한 상품은 누적 발주이력-최근 360일 판매를 상한편향 임시재고로 사용해 오늘 판단 가능한 범위를 넓힙니다."
      />

      <section className={`rounded-2xl border p-5 shadow-sm ${report.state === "READY_MVP" ? "border-blue-200 bg-blue-50" : "border-rose-200 bg-rose-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-slate-500">FAST USE · PROVISIONAL V2 · SPEED FIRST</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{report.state}</h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">수동 발주만 · 자동주문 0</strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{report.message}</p>
        <p className="mt-2 text-xs text-slate-500">{new Date(report.generatedAt).toLocaleString("ko-KR")} · {report.mode}</p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <Metric label="평가 상품" value={number.format(report.evaluatedCount)} />
        <Metric label="오늘 판단 가능" value={number.format(report.usableDecisionCount)} emphasized />
        <Metric label="발주 검토" value={number.format(report.orderReviewCount)} emphasized />
        <Metric label="발주 보류" value={number.format(report.holdCount)} />
        <Metric label="상한편향 절충판정" value={number.format(report.fallbackDecisionCount)} />
        <Metric label="수동 검토" value={number.format(report.manualReviewCount)} />
        <Metric label="데이터 보류" value={number.format(report.dataHoldCount)} />
      </section>

      <section className="rounded-2xl border border-violet-200 bg-violet-50 p-5 text-sm leading-6 text-violet-950">
        <strong>V2 절충 원칙 · 과잉발주보다 발주 지연 쪽 위험을 택합니다.</strong><br />
        과거 누적 발주수량에서 최근 360일 exact 판매만 빼면 과거 360일 이전 판매가 빠져 있어 임시재고가 실제보다 높게 계산될 수 있습니다. 따라서 이 값으로 계산한 발주수량은 과하게 커지기보다 작아지거나 0이 되는 방향입니다. 빠르게 운영을 시작하고, 실제 품절 0-reset과 신규 입고가 쌓이면서 정확도를 올립니다.
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-black text-slate-950">오늘 사용할 발주 판단표</h2>
          <p className="mt-1 text-sm text-slate-500">
            `TWO_SIDED_BAND`가 가장 강한 판단입니다. `CUMULATIVE_UPPER_BIASED`는 빠른 사용을 위한 절충값이며, 실제 주문은 표를 보고 수동으로 진행합니다.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1650px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs font-bold text-slate-500">
              <tr>
                <th className="px-3 py-3">판정</th>
                <th className="px-3 py-3">근거</th>
                <th className="px-3 py-3">편향</th>
                <th className="px-3 py-3">B-code</th>
                <th className="px-3 py-3">모델번호</th>
                <th className="px-3 py-3">상품</th>
                <th className="px-3 py-3 text-right">MVP 권장수량</th>
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
                  <td className="px-3 py-4 font-mono text-xs font-black text-slate-700">{row.basis}</td>
                  <td className="px-3 py-4 font-mono text-[11px] text-slate-500">{row.riskBias}</td>
                  <td className="px-3 py-4 font-mono font-black text-slate-950">{row.barcode}</td>
                  <td className="px-3 py-4 font-mono text-slate-600">{row.modelNo ?? "-"}</td>
                  <td className="px-3 py-4 font-bold text-slate-900">{row.productName}</td>
                  <td className={`px-3 py-4 text-right text-lg font-black ${positiveAction(row.action) ? "text-blue-700" : "text-slate-500"}`}>
                    {number.format(row.recommendedQuantity)}
                  </td>
                  <td className="px-3 py-4 text-right font-black text-violet-800">{qty(row.planningInventoryQuantity)}</td>
                  <td className="px-3 py-4 text-right">{qty(row.inventoryBandLow)}</td>
                  <td className="px-3 py-4 text-right">{qty(row.inventoryBandHigh)}</td>
                  <td className="px-3 py-4 text-right">{qty(row.lowScenarioRecommendedQuantity)}</td>
                  <td className="px-3 py-4 text-right">{qty(row.highScenarioRecommendedQuantity)}</td>
                  <td className="px-3 py-4 text-xs leading-5 text-slate-500">{row.reason}</td>
                </tr>
              )) : (
                <tr><td colSpan={13} className="px-3 py-10 text-center text-slate-500">현재 표시할 MVP 발주 판단이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        <strong>운영 규칙</strong><br />
        `발주 검토`와 `보수적 발주 검토`만 실제 주문 후보로 봅니다. `발주 보류`와 `보수적 발주 보류`는 오늘 주문하지 않습니다. `수동 검토`는 재고 가정에 따라 결론이 뒤집히는 상품이라 사람 판단을 유지하고, `데이터 보류`는 이번 MVP에서 제외합니다. 이 화면은 Product Master 재고를 VERIFIED로 바꾸거나 중국 주문·결제를 자동 실행하지 않습니다.
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
