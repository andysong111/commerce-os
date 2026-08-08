import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadCandidateDemandParityStatus } from "@/lib/stage8CandidateDemandParity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function Stage8CandidateDemandParityPage() {
  const status = await loadCandidateDemandParityStatus();
  const report = status.report;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · PRE-WRITE DEMAND PARITY"
        title="Product Master 쓰기 전 후보 판매수요 비교"
        description="새 canonical 판매 이벤트 후보를 Product Master에 적재하기 전에, 같은 analysisAsOf의 Shopling 주문을 다시 읽어 활성 B코드별 12×30일 수량·매출을 검증합니다. 이 단계에서는 Product Master 판매원장을 변경하지 않습니다."
        actions={
          <div className="flex gap-2">
            <Link href="/stage8-sales-events" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              판매 이벤트 후보
            </Link>
            <Link href="/stage8-demand-parity" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              기존 운영원장 비교
            </Link>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={status.state} />
        <Metric label="수집 구간" value={`${status.completedRanges}/${status.totalRanges}`} />
        <Metric label="진행률" value={`${status.progress}%`} />
        <Metric label="차단 신호" value={number.format(status.blockerCount)} />
        <Metric label="후보 SKU" value={report ? number.format(report.candidateRowCount) : "-"} />
        <Metric label="완전일치 SKU" value={report ? number.format(report.exactRowCount) : "-"} />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${status.state === "MATCH" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
        <h2 className="text-lg font-black text-slate-950">{status.stage}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">{status.message}</p>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          이 검증이 끝나기 전에는 새 후보 plan을 Product Master에 canary/full 적재하지 않습니다. 차이가 남으면 기존 직접집계 숫자에 억지로 맞추지 않고 원주문행 증거로 원인을 분리합니다.
        </p>
      </section>

      {report ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="공유 SKU" value={number.format(report.sharedRowCount)} />
            <Metric label="수량 불일치 SKU" value={number.format(report.unitMismatchCount)} />
            <Metric label="매출 불일치 SKU" value={number.format(report.revenueMismatchCount)} />
            <Metric label="직접집계 누락 SKU" value={number.format(report.missingDirectCount)} />
            <Metric label="후보 수량" value={number.format(report.candidateManagedUnits)} />
            <Metric label="직접집계 수량" value={number.format(report.directManagedUnits)} />
            <Metric label="후보 매출" value={`${number.format(report.candidateManagedRevenue)}원`} />
            <Metric label="직접집계 매출" value={`${number.format(report.directManagedRevenue)}원`} />
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">남은 차이 표본</h2>
            <p className="mt-2 text-sm text-slate-600">
              후보−직접집계 합계 · 수량 {number.format(report.candidateMinusDirectUnits)} · 매출 {number.format(report.candidateMinusDirectRevenue)}원. 동일 행이 두 방식에서 모두 수락된 뒤 계산 차이가 생기는지, 아니면 identity 범위 차이인지 다음 증거 단계에서 판별합니다.
            </p>
            {report.mismatchSamples.length ? (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-[1300px] text-left text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="px-3 py-2">바코드</th>
                      <th className="px-3 py-2">수량 차이 구간</th>
                      <th className="px-3 py-2">매출 차이 구간</th>
                      <th className="px-3 py-2">후보 수량 12구간</th>
                      <th className="px-3 py-2">직접 수량 12구간</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.mismatchSamples.map((row) => (
                      <tr key={row.barcode} className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2 font-black text-slate-950">{row.barcode}</td>
                        <td className="px-3 py-2">{row.unitBuckets.join(", ") || "-"}</td>
                        <td className="px-3 py-2">{row.revenueBuckets.join(", ") || "-"}</td>
                        <td className="px-3 py-2">{row.candidateUnits.join(" / ")}</td>
                        <td className="px-3 py-2">{row.directUnits.join(" / ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">SKU별 수량·매출 차이가 없습니다.</p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
            <strong>후보 판매 이벤트</strong> · {report.candidateSalesRequestId}<br />
            <strong>분석시점</strong> · {report.analysisAsOf}<br />
            <strong>후보 plan</strong> · <span className="break-all text-xs">{report.candidatePlanFingerprint}</span><br />
            <strong>후보 event</strong> · <span className="break-all text-xs">{report.candidateEventFingerprint}</span><br />
            <strong>비교 지문</strong> · <span className="break-all text-xs">{report.parityFingerprint}</span><br />
            <strong>안전</strong> · Shopling GET과 Ops operation 증거 원장만 사용하며 Product Master 판매 이벤트 write는 수행하지 않습니다.
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
