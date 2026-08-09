import { PageHeader } from "@/components/PageHeader";
import { loadLatestOrderProvisionalValidation } from "@/lib/stage8LatestOrderProvisionalValidation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function Stage8LatestOrderProvisionalValidationPage() {
  const validation = await loadLatestOrderProvisionalValidation();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · LATEST ORDER PROVISIONAL VALIDATION"
        title="최신 과거발주 기반 추정재고 후보식 검증"
        description="누적 발주 전체가 아니라 가장 최근 발주 1회의 수량에서 이후 Canonical 판매를 차감하는 방식이 실제 재고에 얼마나 가까운지 BGG1-1 실물 3,000개로 검증합니다. 아직 실제 재고·발주에 사용하지 않습니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={validation.state} />
        <Metric label="대상" value={validation.barcode} />
        <Metric label="최신 과거발주" value={`${number.format(validation.latestOrderQuantity)}개`} />
        <Metric label="실물 검증" value={`${number.format(validation.physicalQuantity)}개`} />
        <Metric label="Canonical 360일" value={`${number.format(validation.canonicalTarget360Quantity)}개`} />
        <Metric label="재고 write" value="0 · READ ONLY" />
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
        <span className="text-xs font-black tracking-[0.14em] text-amber-700">
          ORDER SURROGATE · VALIDATION ONLY
        </span>
        <h2 className="mt-1 text-xl font-black text-amber-950">
          {validation.barcode} · {validation.productName}
        </h2>
        <p className="mt-3 text-sm leading-6 text-amber-900">{validation.message}</p>
        <p className="mt-3 text-xs leading-6 text-amber-700">
          최신 발주일 {validation.latestOrderDate || "-"} · Canonical analysisAsOf {validation.salesEventAnalysisAsOf ?? "-"} · 실물 관찰일 {validation.physicalObservedOn || "-"}
        </p>
      </section>

      {validation.scenarios.length ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-950">입고지연 가정별 검증</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                발주일 바로 다음부터 판매를 빼는 경우와 7·14·21일 뒤부터 빼는 경우를 모두 계산합니다. 가장 가까운 결과도 운영값으로 자동 승격하지 않습니다.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
              물리오차 최소 · {validation.bestLeadDaysByPhysicalError ?? "-"}일 가정 · {validation.bestAbsoluteErrorPct === null ? "-" : `${validation.bestAbsoluteErrorPct.toFixed(2)}%`}
            </span>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[900px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs font-bold text-slate-500">
                <tr>
                  <th className="px-3 py-2">입고지연 가정</th>
                  <th className="px-3 py-2">판매차감 시작일</th>
                  <th className="px-3 py-2 text-right">이후 Canonical 판매</th>
                  <th className="px-3 py-2 text-right">후보 잔여재고</th>
                  <th className="px-3 py-2 text-right">실물 3,000 대비 차이</th>
                  <th className="px-3 py-2 text-right">절대오차</th>
                  <th className="px-3 py-2">성격</th>
                </tr>
              </thead>
              <tbody>
                {validation.scenarios.map((row) => (
                  <tr key={row.leadDays} className="border-b border-slate-100">
                    <td className="px-3 py-2 font-bold text-slate-950">{row.leadDays}일</td>
                    <td className="px-3 py-2">{row.deductionStartDate}</td>
                    <td className="px-3 py-2 text-right">{number.format(row.canonicalSalesSinceStart)}개</td>
                    <td className="px-3 py-2 text-right font-bold">{number.format(row.diagnosticResidualQuantity)}개</td>
                    <td className="px-3 py-2 text-right">{number.format(row.deltaToPhysical)}개</td>
                    <td className="px-3 py-2 text-right">{row.absoluteErrorPct.toFixed(2)}%</td>
                    <td className="px-3 py-2">{row.conservativeRelativeToPhysical ? "실물 이하" : "실물 초과"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm leading-6 text-rose-900 shadow-sm">
        <strong>자동 승격 금지.</strong> 과거 발주수량은 확정입고가 아닙니다. 이 검증이 잘 맞더라도 한 상품만으로 전체 42개 SKU의 실제재고를 단정하지 않습니다. 우선 후보식의 오차와 방향성을 확인한 뒤, 디지털 증거를 더 붙여 PROVISIONAL 안전범위를 만들 때만 사용합니다.
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-xs leading-6 text-slate-600">
        Canonical event · {number.format(validation.canonicalEventCount)}건 · 대상 유효판매 이벤트 {number.format(validation.canonicalTargetValidEventCount)}건
        <br />검증 지문 · <span className="break-all">{validation.fingerprint}</span>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block break-all text-lg text-slate-950">{value}</strong>
    </article>
  );
}
