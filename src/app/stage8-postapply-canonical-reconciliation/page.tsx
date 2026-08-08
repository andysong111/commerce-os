import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadPostApplyCanonicalReconciliation } from "@/lib/stage8PostApplyCanonicalReconciliation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function Stage8PostApplyCanonicalReconciliationPage() {
  const result = await loadPostApplyCanonicalReconciliation();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · POST-APPLY RECONCILIATION"
        title="Persisted Canonical 판매원장 최종 대사"
        description="승인된 쓰기 전 candidate와 실제 Product Master에 저장된 12×30일 canonical 원장을 같은 analysisAsOf로 다시 대조합니다. 이 단계는 읽기 전용이며 발주·가격·재고를 변경하지 않습니다."
        actions={
          <div className="flex gap-2">
            <Link href="/stage8-candidate-promotion-gate" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              쓰기 전 승인 게이트
            </Link>
            <Link href="/stage8-canonical-sales-audit" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              Persisted 원장 재검증
            </Link>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={result.state} />
        <Metric label="Candidate 이벤트" value={number.format(result.candidateSourceEventCount)} />
        <Metric label="Persisted 이벤트" value={number.format(result.persistedSourceEventCount)} />
        <Metric label="Candidate active SKU" value={number.format(result.candidateActiveRowCount)} />
        <Metric label="완전일치 active SKU" value={number.format(result.exactActiveRowCount)} />
        <Metric label="FULL 검증 write" value={number.format(result.fullApplyWritten)} />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${result.ready ? "border-emerald-200 bg-emerald-50" : result.state === "WAITING" ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-bold tracking-wide text-slate-500">대사 결과</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{result.state}</h2>
          </div>
          <strong className={`rounded-full px-4 py-2 text-sm text-white ${result.ready ? "bg-emerald-700" : "bg-amber-700"}`}>
            {result.ready ? "PERSISTED CANDIDATE 일치" : "다음 전환 차단"}
          </strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{result.message}</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">Fail-closed 대사 항목</h2>
        <div className="mt-4 space-y-2">
          {result.checks.map((row) => (
            <article key={row.key} className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <strong className={row.passed ? "text-emerald-700" : "text-rose-700"}>
                {row.passed ? "PASS" : "BLOCK"}
              </strong>
              <div>
                <div className="font-bold text-slate-900">{row.key}</div>
                <p className="mt-1 text-xs leading-5 text-slate-600">{row.message}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Candidate 정상판매" value={number.format(result.candidateValidEventCount)} />
        <Metric label="Persisted 정상판매" value={number.format(result.persistedValidEventCount)} />
        <Metric label="Candidate tombstone" value={number.format(result.candidateTombstoneCount)} />
        <Metric label="Persisted tombstone" value={number.format(result.persistedTombstoneCount)} />
        <Metric label="Persisted active SKU" value={number.format(result.persistedActiveRowCount)} />
        <Metric label="공유 active SKU" value={number.format(result.sharedActiveRowCount)} />
        <Metric label="Candidate 누락" value={number.format(result.missingPersistedCount)} />
        <Metric label="추가 persisted 판매보유" value={number.format(result.extraPersistedNonZeroCount)} />
      </section>

      {result.extraPersistedDiagnostics.length ? (
        <section className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">Candidate에 없는 Persisted active SKU 진단</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Product Master는 active인데 frozen planning candidate에는 없었던 SKU를 그대로 펼칩니다. 판매값이 있는 SKU는 planning의 active 상태·중복 여부를 확인하기 전까지 다음 전환을 차단합니다.</p>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[1500px] text-left text-xs">
              <thead className="text-slate-500"><tr><th className="px-3 py-2">바코드</th><th className="px-3 py-2">판매값</th><th className="px-3 py-2">정상 이벤트</th><th className="px-3 py-2">12구간 수량</th><th className="px-3 py-2">최근판매</th><th className="px-3 py-2">Planning 행</th><th className="px-3 py-2">active Planning 행</th><th className="px-3 py-2">Candidate 제외 이유</th><th className="px-3 py-2">Planning 상세</th></tr></thead>
              <tbody>{result.extraPersistedDiagnostics.map((row) => (
                <tr key={row.barcode} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 font-black text-slate-950">{row.barcode}</td>
                  <td className={`px-3 py-2 font-black ${row.persistedHasDemand ? "text-rose-700" : "text-slate-500"}`}>{row.persistedHasDemand ? "있음" : "0"}</td>
                  <td className="px-3 py-2">{number.format(row.persistedValidEventCount)}</td>
                  <td className="px-3 py-2">{row.persistedMonthlyUnits.join(" / ")}</td>
                  <td className="px-3 py-2">{row.persistedLastSaleAt ?? "-"}</td>
                  <td className="px-3 py-2">{number.format(row.planningMatchCount)}</td>
                  <td className="px-3 py-2">{number.format(row.activePlanningMatchCount)}</td>
                  <td className="px-3 py-2 font-bold">{row.candidateOmissionReason}</td>
                  <td className="px-3 py-2">{row.planningMatches.length ? row.planningMatches.map((match) => `${match.skuId || "-"} · ${match.modelNo || "-"} · ${match.productName} · skuActive=${String(match.skuActive)} · listing ${match.activeListingCount}/${match.listingCount}`).join(" | ") : "없음"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      ) : null}

      {result.rowMismatchSamples.length ? (
        <section className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">Persisted 배열 불일치 표본</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[1300px] text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="px-3 py-2">바코드</th>
                  <th className="px-3 py-2">수량 차이구간</th>
                  <th className="px-3 py-2">매출 차이구간</th>
                  <th className="px-3 py-2">Candidate 수량</th>
                  <th className="px-3 py-2">Persisted 수량</th>
                </tr>
              </thead>
              <tbody>
                {result.rowMismatchSamples.map((row) => (
                  <tr key={row.barcode} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 font-black text-slate-950">{row.barcode}</td>
                    <td className="px-3 py-2">{row.unitBuckets.join(", ") || "-"}</td>
                    <td className="px-3 py-2">{row.revenueBuckets.join(", ") || "-"}</td>
                    <td className="px-3 py-2">{row.candidateUnits.join(" / ")}</td>
                    <td className="px-3 py-2">{row.persistedUnits.join(" / ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
        <strong>Candidate request</strong> · {result.candidateSalesRequestId ?? "-"}<br />
        <strong>analysisAsOf</strong> · {result.analysisAsOf ?? "-"}<br />
        <strong>Candidate plan</strong> · <span className="break-all text-xs">{result.candidatePlanFingerprint ?? "-"}</span><br />
        <strong>Candidate event</strong> · <span className="break-all text-xs">{result.candidateEventFingerprint ?? "-"}</span><br />
        <strong>Persisted content</strong> · <span className="break-all text-xs">{result.persistedContentFingerprint ?? "-"}</span><br />
        <strong>Reconciliation</strong> · <span className="break-all text-xs">{result.reconciliationFingerprint ?? "-"}</span><br />
        <strong>추가 persisted active SKU</strong> · {result.extraPersistedBarcodes.length ? result.extraPersistedBarcodes.join(", ") : "없음"}<br />
        <strong>안전</strong> · persisted 추가 SKU가 있어도 판매 배열과 이벤트수가 모두 0일 때만 허용합니다. Legacy 직접집계가 놓친 BAB3-1의 증명된 15개 판매는 Candidate와 Persisted가 서로 일치하면 정상 canonical history로 유지합니다.
      </section>
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
