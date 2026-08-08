import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadCanonicalSalesEventIncrementalShadowStatus } from "@/lib/canonicalSalesEventIncrementalShadow";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function CanonicalSalesEventIncrementalShadowPage() {
  const status = await loadCanonicalSalesEventIncrementalShadowStatus();
  const report = status.report;
  const ready = status.state === "SHADOW_READY";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · EXACT EVENT MAINTENANCE SHADOW"
        title="Canonical exact-event 증분 유지 그림자"
        description="최근 3개 완료월+현재월 Shopling 주문행을 7일 단위로 다시 읽고, Product Master의 기존 canonical event 원장과 externalId 단위로 읽기 전용 대조합니다. 신규·변경 후보만 찾으며 이 단계에서는 판매원장·발주·가격·재고를 절대 쓰지 않습니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/stage8-postapply-canonical-reconciliation" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              Persisted 최종 대사
            </Link>
            <Link href="/stage8-canonical-purchase-shadow" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              Canonical 발주 shadow
            </Link>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={status.state} />
        <Metric label="Source range" value={`${status.completedRanges}/${status.totalRanges}`} />
        <Metric label="Verify batch" value={`${status.verifiedBatches}/${status.totalVerifyBatches}`} />
        <Metric label="진행률" value={`${status.progress}%`} />
        <Metric label="실제 쓰기" value="0 · DISABLED" />
        <Metric label="설정" value={status.configured ? "READY" : "BLOCK"} />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${ready ? "border-emerald-200 bg-emerald-50" : status.state === "FAILED" || status.state === "BLOCKED" ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-bold tracking-wide text-slate-500">EXACT EVENT INCREMENTAL</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">
              {ready ? "SHADOW READY" : status.stage}
            </h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">
            SALES EVENT WRITE BLOCKED
          </strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{status.message}</p>
        <div className="mt-4 grid gap-2 text-xs text-slate-700 md:grid-cols-2 xl:grid-cols-4">
          <Info label="requestId" value={status.requestId ?? "-"} />
          <Info label="analysisAsOf" value={status.analysisAsOf ?? "-"} />
          <Info label="overlap start" value={status.startDate ?? "-"} />
          <Info label="overlap end" value={status.endDate ?? "-"} />
        </div>
      </section>

      {report ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Metric label="Shopling fetched" value={number.format(report.fetchedRows)} />
            <Metric label="Candidate events" value={number.format(report.candidateEventCount)} />
            <Metric label="Persisted exact" value={number.format(report.persistedExactMatchCount)} />
            <Metric label="신규·변경 후보" value={number.format(report.pendingMismatchCount)} />
            <Metric label="정상판매 후보" value={number.format(report.candidateValidCount)} />
            <Metric label="Tombstone 후보" value={number.format(report.candidateTombstoneCount)} />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Candidate base units" value={number.format(report.candidateBaseUnits)} />
            <Metric label="Candidate revenue" value={`${number.format(report.candidateRevenue)}원`} />
            <Metric label="미연결" value={number.format(report.unmappedRows)} />
            <Metric label="identity/time 충돌" value={number.format(report.identityConflictCount)} />
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">Persisted와 다른 externalId</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  신규 주문행 또는 수량·매출·상태(tombstone 포함)가 달라진 후보입니다. 아직 어떤 행도 Product Master에 적용하지 않습니다.
                </p>
              </div>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">
                {number.format(report.pendingMismatchCount)}건 pending
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {report.pendingMismatchExternalIds.length ? report.pendingMismatchExternalIds.map((id) => (
                <code key={id} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">{id}</code>
              )) : <span className="text-sm font-bold text-emerald-700">현재 overlap에는 신규·변경 후보가 없습니다.</span>}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
            <strong>Overlap 정책</strong> · 최근 3개 완료월 + 현재월, Shopling source range 7일 분할<br />
            <strong>Planning mapping</strong> · <span className="break-all text-xs">{report.planningMappingFingerprint}</span><br />
            <strong>Baseline reconciliation</strong> · <span className="break-all text-xs">{report.baselineReconciliationFingerprint}</span><br />
            <strong>Candidate fingerprint</strong> · <span className="break-all text-xs">{report.candidateFingerprint}</span><br />
            <strong>Verify batches</strong> · {number.format(report.verifyBatchCount)}개<br />
            <strong>전체 360일 전수검증</strong> · 별도 주기 필요. overlap shadow만으로 과거 4개월 이전 변경 가능성을 0으로 가정하지 않습니다.<br />
            <strong>다음 전환</strong> · mismatch의 기존 persisted 값을 함께 읽어 NEW/STATUS/QUANTITY/REVENUE 변경을 분류한 뒤, 그 증거가 안전할 때만 별도의 canary write 단계를 설계합니다.
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
