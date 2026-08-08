import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadCanonicalEventMismatchEvidenceStatus } from "@/lib/canonicalSalesEventMismatchEvidence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function CanonicalEventMismatchEvidencePage() {
  const status = await loadCanonicalEventMismatchEvidenceStatus();
  const report = status.report;
  const safe = status.state === "NO_CHANGES" || (status.state === "READY" && report?.canaryEligible);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · MISMATCH EVIDENCE"
        title="Canonical event 신규·변경 증거 분류"
        description="Exact-event incremental shadow에서 Product Master와 달랐던 externalId만 다시 읽고 persisted 이전값과 candidate 값을 대조합니다. NEW/상태/수량/매출/시각/identity 변경을 분리하며 이 화면도 읽기 전용입니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/stage8-canonical-sales-event-incremental-shadow" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              Incremental shadow
            </Link>
            <Link href="/stage8-canonical-purchase-shadow" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              Canonical 발주 shadow
            </Link>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Evidence 상태" value={status.state} />
        <Metric label="실제 쓰기" value="0 · DISABLED" />
        <Metric label="신규·변경" value={number.format(report?.inspectedMismatchCount ?? 0)} />
        <Metric label="Canary 가능" value={number.format(report?.canaryEligibleCount ?? 0)} />
        <Metric label="Canary 차단" value={number.format(report?.unsafeForCanaryCount ?? 0)} />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${safe ? "border-emerald-200 bg-emerald-50" : status.state === "FAILED" ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-bold tracking-wide text-slate-500">PERSISTED BEFORE/AFTER EVIDENCE</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">
              {status.state === "NO_CHANGES" ? "NO CHANGES" : report?.canaryEligible ? "CLASSIFIED · CANARY ELIGIBLE" : status.state}
            </h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">AUTOMATIC WRITE OFF</strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{status.message}</p>
      </section>

      {report ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Metric label="NEW" value={number.format(report.newEventCount)} />
            <Metric label="상태변경" value={number.format(report.statusChangeCount)} />
            <Metric label="수량변경" value={number.format(report.quantityChangeCount)} />
            <Metric label="매출변경" value={number.format(report.revenueChangeCount)} />
            <Metric label="시각변경" value={number.format(report.occurredAtChangeCount)} />
            <Metric label="Identity 차단" value={number.format(report.identityMismatchCount)} />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Metadata 변경" value={number.format(report.metadataChangeCount)} />
            <Metric label="다중필드 변경" value={number.format(report.multiFieldCount)} />
            <Metric label="Candidate 정상판매" value={number.format(report.candidateValidCount)} />
            <Metric label="Candidate tombstone" value={number.format(report.candidateTombstoneCount)} />
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">Persisted ↔ Candidate 상세 증거</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">최대 100개 샘플입니다. persisted가 없으면 NEW, 기존 값이 있으면 어떤 필드가 바뀌었는지 그대로 표시합니다.</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-black ${report.canaryEligible ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                {report.canaryEligible ? "CANARY ELIGIBLE" : "CANARY BLOCKED"}
              </span>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[1500px] text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="px-3 py-2">externalId</th>
                    <th className="px-3 py-2">구분</th>
                    <th className="px-3 py-2">차이</th>
                    <th className="px-3 py-2">바코드</th>
                    <th className="px-3 py-2">예상 skuId</th>
                    <th className="px-3 py-2">Candidate</th>
                    <th className="px-3 py-2">Persisted</th>
                  </tr>
                </thead>
                <tbody>
                  {report.detailSamples.map((row) => (
                    <tr key={row.externalId} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2 font-mono font-bold text-slate-950">{row.externalId}</td>
                      <td className="px-3 py-2 font-black">{row.changeKind}</td>
                      <td className="px-3 py-2">{row.differences.join(", ") || "-"}</td>
                      <td className="px-3 py-2 font-bold">{row.candidate.barcode}</td>
                      <td className="px-3 py-2 font-mono">{row.expectedSkuId ?? "UNRESOLVED"}</td>
                      <td className="px-3 py-2">{row.candidate.occurredAt} · qty {number.format(row.candidate.quantity)} · rev {number.format(row.candidate.revenue)} · valid {String(row.candidate.validSale)}</td>
                      <td className="px-3 py-2">{row.persisted ? `${row.persisted.skuId} · ${row.persisted.occurredAt} · qty ${number.format(row.persisted.quantity)} · rev ${number.format(row.persisted.revenue)} · valid ${String(row.persisted.validSale)}` : "없음"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!report.detailSamples.length ? <p className="py-5 text-sm font-bold text-emerald-700">현재 persisted와 다른 event가 없습니다.</p> : null}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
            <strong>Shadow request</strong> · {report.shadowRequestId}<br />
            <strong>analysisAsOf</strong> · {report.analysisAsOf}<br />
            <strong>Candidate fingerprint</strong> · <span className="break-all text-xs">{report.candidateFingerprint}</span><br />
            <strong>Canary eligibility</strong> · identity/metadata/occurredAt 차이가 0이고 NEW·상태·수량·매출 변경만 있을 때만 true입니다.<br />
            <strong>자동쓰기</strong> · {String(report.automaticWriteEnabled)} · 별도의 1건 canary/재검증 단계가 생기기 전까지 항상 false입니다.
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
