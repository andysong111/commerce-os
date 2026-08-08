import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadCanonicalDemandParityStatus } from "@/lib/stage8CanonicalDemandParity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function Stage8DemandParityPage() {
  const status = await loadCanonicalDemandParityStatus();
  const report = status.report;
  const matched = status.state === "MATCH";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · PURCHASE DEMAND PARITY"
        title="Canonical 발주수요 동일시점 비교"
        description="Product Master의 12×30일 판매수요와 같은 analysisAsOf로 Shopling 주문을 다시 읽어 기존 직접 집계 방식과 SKU별 수량·매출을 비교합니다. 발주·가격·재고 쓰기는 없습니다."
        actions={
          <div className="flex gap-2">
            <Link href="/stage8-canonical-sales-audit" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              판매원장 재검증
            </Link>
            <Link href="/stage8-readiness" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              Stage8 준비도
            </Link>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={status.state} />
        <Metric label="수집 구간" value={`${status.completedRanges}/${status.totalRanges}`} />
        <Metric label="진행률" value={`${status.progress}%`} />
        <Metric label="차단" value={number.format(status.blockerCount)} />
        <Metric label="Canonical SKU" value={report ? number.format(report.canonicalRowCount) : "-"} />
        <Metric label="완전일치 SKU" value={report ? number.format(report.exactRowCount) : "-"} />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${matched ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
        <h2 className="text-lg font-black text-slate-950">{status.stage}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">{status.message}</p>
      </section>

      {report ? (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">SKU별 12×30일 비교 결과</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="공유 SKU" value={number.format(report.sharedRowCount)} />
              <Metric label="수량 불일치 SKU" value={number.format(report.unitMismatchCount)} />
              <Metric label="매출 불일치 SKU" value={number.format(report.revenueMismatchCount)} />
              <Metric label="직접집계 누락 SKU" value={number.format(report.missingDirectCount)} />
              <Metric label="직접집계 전용 B코드" value={number.format(report.directOnlyManagedCount)} />
              <Metric label="Shopling 읽은 행" value={number.format(report.directFetchedRows)} />
              <Metric label="직접 집계 수락행" value={number.format(report.directAcceptedRows)} />
              <Metric label="직접 집계 미연결행" value={number.format(report.directUnmappedRows)} />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">관리 SKU 판매합계</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Canonical 수량" value={number.format(report.canonicalManagedUnits)} />
              <Metric label="직접집계 수량" value={number.format(report.directManagedUnits)} />
              <Metric label="Canonical 매출" value={`${number.format(report.canonicalManagedRevenue)}원`} />
              <Metric label="직접집계 매출" value={`${number.format(report.directManagedRevenue)}원`} />
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              포트폴리오 예산의 최근30일 총매출은 관리 B코드만의 매출과 범위가 다를 수 있으므로 별도 보조신호로 유지합니다. 동일성 게이트는 현재 관리 SKU의 12×30일 수량·매출 배열에만 적용합니다.
            </p>
            <p className="mt-2 text-sm font-semibold text-slate-700">직접 Shopling 최근30일 포트폴리오 매출 · {number.format(report.directPortfolioRecent30Revenue)}원</p>
          </section>

          {report.mismatchSamples.length ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
              <h2 className="text-lg font-black text-slate-950">차이 표본</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2">바코드</th>
                      <th className="px-3 py-2">수량 차이 구간</th>
                      <th className="px-3 py-2">매출 차이 구간</th>
                      <th className="px-3 py-2">Canonical 수량</th>
                      <th className="px-3 py-2">직접 수량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.mismatchSamples.map((row) => (
                      <tr key={row.barcode} className="border-t border-amber-100 align-top">
                        <td className="px-3 py-2 font-black text-slate-900">{row.barcode}</td>
                        <td className="px-3 py-2">{row.unitBuckets.join(", ") || "-"}</td>
                        <td className="px-3 py-2">{row.revenueBuckets.join(", ") || "-"}</td>
                        <td className="px-3 py-2 text-xs">{row.canonicalUnits.join(" / ")}</td>
                        <td className="px-3 py-2 text-xs">{row.directUnits.join(" / ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
            <strong>비교 지문</strong> · <span className="break-all text-xs">{report.parityFingerprint}</span><br />
            <strong>분석시점</strong> · {report.analysisAsOf}<br />
            <strong>안전 원칙</strong> · 차이가 1건이라도 있으면 canonical 발주수요 전환을 자동 승인하지 않습니다. 이 비교는 Shopling GET과 Ops operation 원장 기록만 사용합니다.
          </section>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block text-lg text-slate-950">{value}</strong>
    </article>
  );
}
