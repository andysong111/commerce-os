import { PageHeader } from "@/components/PageHeader";
import { loadHistoricalSalesCoverageAudit } from "@/lib/stage8HistoricalSalesCoverageAudit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function Stage8HistoricalSalesCoverageAuditPage() {
  const audit = await loadHistoricalSalesCoverageAudit();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · HISTORICAL SALES COVERAGE"
        title="24개월 과거 판매증거 재사용 점검"
        description="이미 수집해 둔 Shopling 24개월 operation ledger만 다시 읽어서 Canonical 360일 이전 판매가 남아 있는지 확인합니다. Shopling을 다시 호출하거나 상품마스터 판매·재고를 변경하지 않습니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="상태" value={audit.state} />
        <Metric label="24개월 작업" value={audit.backfillState} />
        <Metric label="저장 chunk" value={`${number.format(audit.chunkEvidenceCount)}개`} />
        <Metric label="비즈니스 write" value="0 · READ ONLY" />
        <Metric label="재고 write" value="0 · READ ONLY" />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">기존 증거 재사용</h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">{audit.message}</p>
        <p className="mt-3 text-xs text-slate-500">
          전체 24개월 월 범위 · {audit.backfillGlobalMonthRange ?? "-"} · Canonical analysisAsOf · {audit.canonicalAnalysisAsOf ?? "-"}
        </p>
      </section>

      {audit.rows.map((row) => (
        <section key={row.barcode} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <span className="text-xs font-semibold text-slate-500">{row.modelNumber}</span>
              <h2 className="text-xl font-black text-slate-950">{row.barcode} · {row.productName}</h2>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-black ${row.historicalMonthPresentBeforeCanonicalWindow ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              {row.historicalMonthPresentBeforeCanonicalWindow ? "360일 이전 월 증거 있음" : "360일 이전 월 증거 없음"}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="Canonical 360일" value={`${number.format(row.canonical360SalesQuantity)}개`} />
            <Metric label="24개월 저장 판매" value={`${number.format(row.backfillSalesQuantity)}개`} />
            <Metric label="360일 시작월 이전" value={`${number.format(row.backfillPreCanonicalFullMonthQuantity)}개`} />
            <Metric label="360일 시작월" value={`${number.format(row.backfillCanonicalStartMonthQuantity)}개`} />
            <Metric label="저장 월 범위" value={row.earliestBackfillMonth ? `${row.earliestBackfillMonth}~${row.latestBackfillMonth}` : "-"} />
          </div>

          <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-bold text-slate-500">
                <tr>
                  <th className="px-3 py-2">월</th>
                  <th className="px-3 py-2 text-right">기본수량 판매</th>
                  <th className="px-3 py-2 text-right">매출</th>
                  <th className="px-3 py-2">마지막 판매</th>
                </tr>
              </thead>
              <tbody>
                {row.months.length ? row.months.map((month) => (
                  <tr key={month.month} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-bold text-slate-900">{month.month}</td>
                    <td className="px-3 py-2 text-right">{number.format(month.quantity)}</td>
                    <td className="px-3 py-2 text-right">{number.format(month.revenue)}원</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{month.lastSaleAt ?? "-"}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-500">이 B-code로 저장된 24개월 월 판매증거가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            이 결과는 과거 판매 커버리지 진단용입니다. 과거 발주수량을 확정입고로 바꾸거나, 여기의 판매합계를 이용해 실제 재고를 쓰지 않습니다.
          </p>
        </section>
      ))}

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-xs leading-6 text-slate-600">
        감사 지문 · <span className="break-all">{audit.fingerprint}</span>
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
