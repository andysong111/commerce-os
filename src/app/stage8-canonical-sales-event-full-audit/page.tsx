import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadCanonicalSalesEventFullAuditStatus } from "@/lib/canonicalSalesEventFullAudit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function CanonicalSalesEventFullAuditPage() {
  const status = await loadCanonicalSalesEventFullAuditStatus();
  const report = status.report;
  const exact = status.state === "EXACT";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · 360-DAY FULL AUDIT"
        title="Canonical 판매이벤트 360일 전수 감사"
        description="4개월 증분 shadow가 놓칠 수 있는 오래된 주문 변경까지 잡기 위해 최근 360일 Shopling 주문행 전체를 exact-event resolver로 다시 읽고 Product Master persisted canonical 원장과 읽기 전용으로 대조합니다. 주 1회 실행하며 실제 쓰기는 없습니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/stage8-canonical-sales-event-incremental-shadow" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              4개월 증분 Shadow
            </Link>
            <Link href="/stage8-canonical-event-mismatch-evidence" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              변경 증거 분류
            </Link>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={status.state} />
        <Metric label="7일 Source range" value={`${status.completedRanges}/${status.totalRanges}`} />
        <Metric label="Event verify batch" value={`${status.verifiedBatches}/${status.totalVerifyBatches}`} />
        <Metric label="진행률" value={`${status.progress}%`} />
        <Metric label="실제 쓰기" value="0 · DISABLED" />
        <Metric label="설정" value={status.configured ? "READY" : "BLOCK"} />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${exact ? "border-emerald-200 bg-emerald-50" : status.state === "DRIFT" || status.state === "FAILED" || status.state === "BLOCKED" ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-bold tracking-wide text-slate-500">WEEKLY FULL CANONICAL AUDIT</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{exact ? "360-DAY EXACT" : status.stage}</h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">READ ONLY · WRITE BLOCKED</strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{status.message}</p>
        <div className="mt-4 grid gap-2 text-xs text-slate-700 md:grid-cols-2">
          <Info label="requestId" value={status.requestId ?? "-"} />
          <Info label="analysisAsOf" value={status.analysisAsOf ?? "-"} />
        </div>
      </section>

      {report ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Metric label="Shopling fetched" value={number.format(report.fetchedRows)} />
            <Metric label="Candidate events" value={number.format(report.candidateEventCount)} />
            <Metric label="Persisted events" value={number.format(report.persistedEventCount)} />
            <Metric label="ExternalId mismatch" value={number.format(report.eventMismatchCount)} />
            <Metric label="Active row mismatch" value={number.format(report.activeRowMismatchCount)} />
            <Metric label="Drift score" value={number.format(report.driftCount)} />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Metric label="Candidate valid" value={number.format(report.candidateValidCount)} />
            <Metric label="Persisted valid" value={number.format(report.persistedValidCount)} />
            <Metric label="Candidate tombstone" value={number.format(report.candidateTombstoneCount)} />
            <Metric label="Persisted tombstone" value={number.format(report.persistedTombstoneCount)} />
            <Metric label="Candidate active SKU" value={number.format(report.candidateActiveRowCount)} />
            <Metric label="Persisted active SKU" value={number.format(report.persistedActiveRowCount)} />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="Exact active SKU" value={number.format(report.exactActiveRowCount)} />
            <Metric label="Candidate 누락" value={number.format(report.missingPersistedBarcodes.length)} />
            <Metric label="Persisted extra" value={number.format(report.extraPersistedBarcodes.length)} />
            <Metric label="Orphan event" value={number.format(report.orphanEventCount)} />
            <Metric label="분류 완전성" value={report.classificationComplete ? "PASS" : "BLOCK"} />
          </section>

          {report.eventMismatchExternalIds.length ? (
            <section className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-slate-950">Persisted와 다른 externalId</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">최대 100개 샘플입니다. 신규 주문이나 과거 주문의 상태·수량·매출 변경 가능성을 의미합니다.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {report.eventMismatchExternalIds.map((id) => (
                  <code key={id} className="rounded-lg border border-rose-100 bg-rose-50 px-2 py-1 text-xs text-rose-800">{id}</code>
                ))}
              </div>
            </section>
          ) : null}

          {report.rowMismatchSamples.length ? (
            <section className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-slate-950">12×30 active SKU 배열 불일치</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-[1450px] text-left text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="px-3 py-2">바코드</th>
                      <th className="px-3 py-2">수량 bucket</th>
                      <th className="px-3 py-2">매출 bucket</th>
                      <th className="px-3 py-2">Candidate units</th>
                      <th className="px-3 py-2">Persisted units</th>
                      <th className="px-3 py-2">Candidate revenue</th>
                      <th className="px-3 py-2">Persisted revenue</th>
                      <th className="px-3 py-2">Valid events</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rowMismatchSamples.map((row) => (
                      <tr key={row.barcode} className="border-t border-slate-100 align-top">
                        <td className="px-3 py-2 font-black">{row.barcode}</td>
                        <td className="px-3 py-2">{row.unitBuckets.join(", ") || "-"}</td>
                        <td className="px-3 py-2">{row.revenueBuckets.join(", ") || "-"}</td>
                        <td className="px-3 py-2">{row.candidateUnits.join(" / ")}</td>
                        <td className="px-3 py-2">{row.persistedUnits.join(" / ")}</td>
                        <td className="px-3 py-2">{row.candidateRevenue.join(" / ")}</td>
                        <td className="px-3 py-2">{row.persistedRevenue.join(" / ")}</td>
                        <td className="px-3 py-2">{row.candidateValidEventCount} / {row.persistedValidEventCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
            <strong>감사 범위</strong> · {report.analysisStartDate} → {report.analysisEndDate}<br />
            <strong>Candidate base units</strong> · {number.format(report.candidateBaseUnits)}<br />
            <strong>Candidate revenue</strong> · {number.format(report.candidateRevenue)}원<br />
            <strong>Persisted exact externalId</strong> · {number.format(report.persistedExactEventCount)}<br />
            <strong>미연결</strong> · {number.format(report.unmappedRows)} · <strong>identity/time 충돌</strong> · {number.format(report.identityConflictCount)}<br />
            <strong>Mapping fingerprint</strong> · <span className="break-all text-xs">{report.planningMappingFingerprint}</span><br />
            <strong>Candidate fingerprint</strong> · <span className="break-all text-xs">{report.candidateFingerprint}</span><br />
            <strong>Persisted fingerprint</strong> · <span className="break-all text-xs">{report.persistedContentFingerprint}</span><br />
            <strong>Audit fingerprint</strong> · <span className="break-all text-xs">{report.auditFingerprint}</span><br />
            <strong>정책</strong> · 주 1회 전체 360일 read-only 감사 + 6시간 4개월 증분 shadow를 함께 사용합니다. 둘 중 하나라도 drift면 canonical ledger 자동승격은 금지합니다.
          </section>
        </>
      ) : null}

      {status.error ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm leading-6 text-rose-800">
          <strong>실패 원인</strong><br />{status.error}
        </section>
      ) : null}
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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/70 p-3">
      <strong>{label}</strong><br /><span className="break-all">{value}</span>
    </div>
  );
}
