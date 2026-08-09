import { PageHeader } from "@/components/PageHeader";
import { loadProvisionalInventoryDiagnostics } from "@/lib/stage8ProvisionalInventoryDiagnostics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function Stage8ProvisionalInventoryDiagnosticsPage() {
  const diagnostics = await loadProvisionalInventoryDiagnostics();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · PROVISIONAL INVENTORY DIAGNOSTICS"
        title="추정재고 불확실성 · 발주민감도 진단"
        description="과거 발주이력 후보와 exact Canonical 판매를 결합해 추정재고가 어느 범위일 때 발주결론이 바뀌는지 읽기 전용으로 계산합니다. 재고 전수조사나 실제 재고 승격 없이 안전한 발주 판단 규칙을 검증하는 단계입니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <Metric label="상태" value={diagnostics.state} />
        <Metric label="증명 정체성" value={`${diagnostics.provenIdentityCount}개`} />
        <Metric label="밴드 계산" value={`${diagnostics.bandReadyCount}개`} />
        <Metric label="재고민감" value={`${diagnostics.inventorySensitiveCount}개`} />
        <Metric label="발주방향 안정" value={`${diagnostics.orderDirectionStableCount}개`} />
        <Metric label="보류방향 안정" value={`${diagnostics.holdDirectionStableCount}개`} />
        <Metric label="Actual write" value="0 · READ ONLY" />
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950 shadow-sm">
        <strong>DIAGNOSTIC ONLY · INVENTORY PROMOTION OFF · DRAFT CREATION OFF</strong>
        <br />
        {diagnostics.message}
        <br />
        Canonical 판매 커버리지 · {diagnostics.canonicalCoverageStartAt ?? "-"} → {diagnostics.canonicalCoverageEndAt ?? "-"}
        <br />
        상위 발주 실행 상태 · <strong>{diagnostics.upstreamPurchaseState}</strong>
        <div className="mt-2 break-all text-xs">Fingerprint · {diagnostics.fingerprint}</div>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-black text-slate-600">
            <tr>
              <th className="px-4 py-3">B-code</th>
              <th className="px-4 py-3">aaa</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3">과거발주 누적</th>
              <th className="px-4 py-3">Canonical 360일 판매</th>
              <th className="px-4 py-3">누적 잔여후보</th>
              <th className="px-4 py-3">최신 잔여후보</th>
              <th className="px-4 py-3">진단 범위</th>
              <th className="px-4 py-3">발주결론</th>
              <th className="px-4 py-3">Low / High 권장</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {diagnostics.rows.map((row) => (
              <tr key={row.barcode}>
                <td className="px-4 py-3 font-black text-slate-950">{row.barcode}</td>
                <td className="px-4 py-3 font-semibold">{row.modelNo ?? "-"}</td>
                <td className="px-4 py-3">
                  <div className="font-semibold">{row.state}</div>
                  <div className="mt-1 max-w-xs text-xs leading-5 text-slate-500">{row.message}</div>
                </td>
                <td className="px-4 py-3">{qty(row.historicalCumulativeOrderQuantity)}</td>
                <td className="px-4 py-3">{number.format(row.canonical360SalesQuantity)}개</td>
                <td className="px-4 py-3">{qty(row.cumulativeResidualCandidate)}</td>
                <td className="px-4 py-3">
                  {qty(row.latestResidualCandidate)}
                  {row.latestDeductionStartDate ? (
                    <div className="mt-1 text-xs text-slate-500">차감 {row.latestDeductionStartDate}~</div>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  {row.diagnosticLowQuantity === null || row.diagnosticHighQuantity === null
                    ? "-"
                    : `${number.format(row.diagnosticLowQuantity)} ~ ${number.format(row.diagnosticHighQuantity)}개`}
                </td>
                <td className="px-4 py-3 font-semibold">{row.decisionState}</td>
                <td className="px-4 py-3">
                  {row.lowRecommendedQuantity === null || row.highRecommendedQuantity === null
                    ? "-"
                    : `${number.format(row.lowRecommendedQuantity)} / ${number.format(row.highRecommendedQuantity)}개`}
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
        <strong className="text-slate-950">판단 규칙</strong>
        <br />
        낮은 추정재고와 높은 추정재고 양쪽 모두 발주면 ORDER_DIRECTION_STABLE, 양쪽 모두 보류면 HOLD_DIRECTION_STABLE, 서로 결론이 다르면 INVENTORY_SENSITIVE입니다. INVENTORY_SENSITIVE는 자동 Draft를 만들지 않습니다. 최신 발주 차감 시작일이 Canonical exact 판매 커버리지보다 앞서면 LATEST_COVERAGE_GAP으로 차단합니다.
      </section>
    </div>
  );
}

function qty(value: number | null) {
  return value === null ? "-" : `${number.format(value)}개`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block break-all text-lg text-slate-950">{value}</strong>
    </article>
  );
}
