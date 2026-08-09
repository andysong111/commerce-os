import { PageHeader } from "@/components/PageHeader";
import { loadStoredMonthlyGapEnvelope } from "@/lib/stage8StoredMonthlyGapEnvelope";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function Stage8StoredMonthlyGapEnvelopePage() {
  const envelope = await loadStoredMonthlyGapEnvelope();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · STORED MONTHLY GAP ENVELOPE"
        title="24개월 저장 판매원장 · 추정재고 공백 보완"
        description="과거 주문 API가 직접 조회되지 않는 구간은 이미 저장·검증 완료된 Shopling 월판매 원장을 재사용합니다. 시작월·종료월의 일별 판매를 만들어내지 않고 경계월 전체를 불확실성으로 남깁니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <Metric label="상태" value={envelope.state} />
        <Metric label="대상 SKU" value={`${envelope.targetCount}개`} />
        <Metric label="밴드 준비" value={`${envelope.readyBandCount}개`} />
        <Metric label="재고민감" value={`${envelope.inventorySensitiveCount}개`} />
        <Metric label="발주방향 안정" value={`${envelope.orderDirectionStableCount}개`} />
        <Metric label="보류방향 안정" value={`${envelope.holdDirectionStableCount}개`} />
        <Metric label="Actual write" value="0 · READ ONLY" />
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950 shadow-sm">
        <strong>STORED MONTHLY EVIDENCE · BOUNDARY MONTHS STAY UNCERTAIN</strong>
        <br />
        {envelope.message}
        <br />
        저장 chunk 커버리지 · {envelope.storedCoverageStart ?? "-"} → {envelope.storedCoverageEnd ?? "-"}
        <br />
        Canonical exact 시작 · {envelope.canonicalCoverageStart ?? "-"}
        <br />
        24개월 backfill · {envelope.backfillState} · {envelope.backfillCompletedRanges}/{envelope.backfillTotalRanges}
        <div className="mt-2 break-all text-xs">Fingerprint · {envelope.fingerprint}</div>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-black text-slate-600">
            <tr>
              <th className="px-4 py-3">B-code</th>
              <th className="px-4 py-3">aaa</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3">공백기간</th>
              <th className="px-4 py-3">경계월 / 완전월</th>
              <th className="px-4 py-3">Gap 판매범위</th>
              <th className="px-4 py-3">최신 잔여범위</th>
              <th className="px-4 py-3">누적 잔여후보</th>
              <th className="px-4 py-3">최종 진단재고범위</th>
              <th className="px-4 py-3">발주결론</th>
              <th className="px-4 py-3">Low / High 권장</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {envelope.rows.map((row) => (
              <tr key={row.barcode}>
                <td className="px-4 py-3 font-black text-slate-950">{row.barcode}</td>
                <td className="px-4 py-3 font-semibold">{row.modelNo}</td>
                <td className="px-4 py-3">
                  <div className="font-semibold">{row.state}</div>
                  <div className="mt-1 max-w-xs text-xs leading-5 text-slate-500">{row.message}</div>
                </td>
                <td className="px-4 py-3 text-xs">{row.gapStartDate} → {row.gapEndDate}</td>
                <td className="px-4 py-3 text-xs leading-5">
                  시작월 {row.startMonth} · {number.format(row.startMonthQuantity)}개
                  <br />
                  완전월 · {number.format(row.interiorFullMonthQuantity)}개
                  <br />
                  종료월 {row.endMonth} · {number.format(row.endMonthQuantity)}개
                </td>
                <td className="px-4 py-3 font-semibold">
                  {number.format(row.gapSalesLowerBound)} ~ {number.format(row.gapSalesUpperBound)}개
                </td>
                <td className="px-4 py-3 font-semibold">
                  {number.format(row.latestResidualLowerBound)} ~ {number.format(row.latestResidualUpperBound)}개
                </td>
                <td className="px-4 py-3">{number.format(row.cumulativeResidualCandidate)}개</td>
                <td className="px-4 py-3 font-black">
                  {number.format(row.diagnosticLowQuantity)} ~ {number.format(row.diagnosticHighQuantity)}개
                </td>
                <td className="px-4 py-3 font-semibold">{row.decisionState}</td>
                <td className="px-4 py-3">
                  {number.format(row.lowRecommendedQuantity)} / {number.format(row.highRecommendedQuantity)}개
                  {row.draftSimulationEligible ? (
                    <div className="mt-1 text-xs font-semibold text-emerald-700">
                      보수 Draft 시뮬레이션 {number.format(row.conservativeDraftRecommendedQuantity)}개
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-700 shadow-sm">
        <strong className="text-slate-950">왜 월판매를 한 숫자로 쪼개지 않는가</strong>
        <br />
        예를 들어 발주 차감 시작일이 10월 15일이어도 저장원장은 10월 전체 판매량만 알고 있습니다. 따라서 10월 15일 이후 판매를 임의 비율로 계산하지 않습니다. 시작월과 Canonical 직전 종료월은 0~월전체 판매량으로 두고, 그 사이 완전한 월만 확정 차감합니다. 이 때문에 범위는 넓어질 수 있지만 존재하지 않는 일별 데이터를 만들어 잘못 발주하는 위험을 피합니다.
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
