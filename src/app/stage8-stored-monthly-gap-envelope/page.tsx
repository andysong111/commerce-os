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
        description="과거 주문 API가 직접 조회되지 않는 구간은 저장된 Shopling 월판매 증거를 검토합니다. 날짜 chunk가 있다고 해서 해당 SKU의 월판매가 0이었다고 가정하지 않으며, B-code 월행이 없는 구간은 차단합니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <Metric label="상태" value={envelope.state} />
        <Metric label="대상 SKU" value={`${envelope.targetCount}개`} />
        <Metric label="밴드 준비" value={`${envelope.readyBandCount}개`} />
        <Metric label="정체성 미증명" value={`${envelope.identityCoverageUnprovenCount}개`} />
        <Metric label="재고민감" value={`${envelope.inventorySensitiveCount}개`} />
        <Metric label="방향안정" value={`${envelope.orderDirectionStableCount + envelope.holdDirectionStableCount}개`} />
        <Metric label="Actual write" value="0 · READ ONLY" />
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950 shadow-sm">
        <strong>ABSENT MONTHLY ROW ≠ ZERO SALES · FAIL CLOSED</strong>
        <br />
        {envelope.message}
        <br />
        저장 chunk 날짜범위 · {envelope.storedCoverageStart ?? "-"} → {envelope.storedCoverageEnd ?? "-"}
        <br />
        실제 저장 월증거 범위 · {envelope.storedEvidenceMonthStart ?? "-"} → {envelope.storedEvidenceMonthEnd ?? "-"}
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
              <th className="px-4 py-3">월증거</th>
              <th className="px-4 py-3">Gap 판매범위</th>
              <th className="px-4 py-3">최신 잔여범위</th>
              <th className="px-4 py-3">누적 잔여후보</th>
              <th className="px-4 py-3">최종 진단재고범위</th>
              <th className="px-4 py-3">발주결론</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {envelope.rows.map((row) => {
              const usable = row.state === "MONTHLY_BAND_READY";
              return (
                <tr key={row.barcode}>
                  <td className="px-4 py-3 font-black text-slate-950">{row.barcode}</td>
                  <td className="px-4 py-3 font-semibold">{row.modelNo}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{row.state}</div>
                    <div className="mt-1 max-w-xs text-xs leading-5 text-slate-500">{row.message}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">{row.gapStartDate} → {row.gapEndDate}</td>
                  <td className="px-4 py-3 text-xs font-semibold">
                    {row.explicitEvidenceMonthCount}/{row.requiredEvidenceMonthCount}개월 명시행
                  </td>
                  <td className="px-4 py-3 font-semibold">
                    {usable ? `${number.format(row.gapSalesLowerBound)} ~ ${number.format(row.gapSalesUpperBound)}개` : "BLOCKED"}
                  </td>
                  <td className="px-4 py-3 font-semibold">
                    {usable ? `${number.format(row.latestResidualLowerBound)} ~ ${number.format(row.latestResidualUpperBound)}개` : "BLOCKED"}
                  </td>
                  <td className="px-4 py-3">{number.format(row.cumulativeResidualCandidate)}개 · 진단만</td>
                  <td className="px-4 py-3 font-black">
                    {usable ? `${number.format(row.diagnosticLowQuantity)} ~ ${number.format(row.diagnosticHighQuantity)}개` : "BLOCKED"}
                  </td>
                  <td className="px-4 py-3 font-semibold">
                    {usable ? row.decisionState : "BLOCKED"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-700 shadow-sm">
        <strong className="text-slate-950">안전규칙</strong>
        <br />
        저장된 chunk의 날짜범위가 과거까지 이어져도 그 안에서 해당 B-code 월행이 없으면 실제 0판매인지, 당시 aaa 코드나 다른 Shopling identity로 판매되어 현재 B-code 집계에서 빠진 것인지 구분할 수 없습니다. 따라서 월행 부재를 0으로 채우지 않습니다. 모든 필요한 월의 SKU 증거가 직접 있을 때만 경계월 불확실성 계산을 허용합니다.
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
