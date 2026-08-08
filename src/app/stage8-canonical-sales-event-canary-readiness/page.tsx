import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadCanonicalSalesEventCanaryReadiness } from "@/lib/canonicalSalesEventCanaryReadiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function CanonicalSalesEventCanaryReadinessPage() {
  const gate = await loadCanonicalSalesEventCanaryReadiness();
  const ready = gate.state === "READY_ONE_EVENT";
  const noChanges = gate.state === "NO_CHANGES";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · ONE EVENT CANARY READINESS"
        title="Canonical event 1건 Canary 준비 게이트"
        description="실제 write API를 상시 노출하지 않고, 향후 신규·변경 event가 생겼을 때 1건만 시험할 수 있는지 읽기 전용으로 판정합니다. 360일 exact 감사·현재 identity mapping·incremental/evidence/baseline fingerprint가 모두 맞아야 하며 자동쓰기는 항상 꺼져 있습니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/stage8-canonical-sales-event-full-audit" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">360일 Full Audit</Link>
            <Link href="/stage8-canonical-event-mismatch-evidence" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">Mismatch Evidence</Link>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Gate 상태" value={gate.state} />
        <Metric label="Canary 준비" value={gate.readyForOneEventCanary ? "YES" : "NO"} />
        <Metric label="최대 write" value={`${gate.maxWriteRows}건`} />
        <Metric label="자동 write" value="OFF" />
        <Metric label="선택 externalId" value={gate.selectedExternalId ?? "-"} />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${ready ? "border-emerald-200 bg-emerald-50" : noChanges ? "border-slate-200 bg-slate-50" : "border-amber-200 bg-amber-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-bold tracking-wide text-slate-500">FAIL-CLOSED CANARY GATE</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">
              {ready ? "READY FOR EXACTLY ONE EVENT" : noChanges ? "NO CHANGES · NO WRITE NEEDED" : gate.state}
            </h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">AUTOMATIC WRITE DISABLED</strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{gate.message}</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">Gate 조건</h2>
        <div className="mt-4 space-y-2">
          {gate.checks.map((row) => (
            <article key={row.key} className={`rounded-xl border p-3 ${row.passed ? "border-emerald-100 bg-emerald-50" : "border-amber-100 bg-amber-50"}`}>
              <div className="flex items-center gap-2">
                <strong className={row.passed ? "text-emerald-700" : "text-amber-800"}>{row.passed ? "PASS" : "BLOCK"}</strong>
                <span className="font-bold text-slate-950">{row.key}</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-600">{row.message}</p>
            </article>
          ))}
        </div>
      </section>

      {gate.selectedCandidate ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">결정론적 1건 후보</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">externalId 오름차순으로 1건만 선택합니다. 이 화면은 선택만 할 뿐 실행하지 않습니다.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="externalId" value={gate.selectedExternalId ?? "-"} />
            <Metric label="변경종류" value={gate.selectedChangeKind ?? "-"} />
            <Metric label="바코드" value={gate.selectedBarcode ?? "-"} />
            <Metric label="예상 skuId" value={gate.selectedExpectedSkuId ?? "-"} />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Info
              label="Candidate"
              value={`${gate.selectedCandidate.occurredAt} · qty ${number.format(gate.selectedCandidate.quantity)} · rev ${number.format(gate.selectedCandidate.revenue)} · valid ${String(gate.selectedCandidate.validSale)}`}
            />
            <Info
              label="Persisted before"
              value={gate.selectedPersisted ? `${gate.selectedPersisted.skuId} · ${gate.selectedPersisted.occurredAt} · qty ${number.format(gate.selectedPersisted.quantity)} · rev ${number.format(gate.selectedPersisted.revenue)} · valid ${String(gate.selectedPersisted.validSale)}` : "없음 · NEW"}
            />
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
        <strong>Current mapping</strong> · <span className="break-all text-xs">{gate.currentMappingFingerprint}</span><br />
        <strong>Incremental candidate</strong> · <span className="break-all text-xs">{gate.incrementalCandidateFingerprint ?? "-"}</span><br />
        <strong>Evidence candidate</strong> · <span className="break-all text-xs">{gate.evidenceCandidateFingerprint ?? "-"}</span><br />
        <strong>Full audit</strong> · <span className="break-all text-xs">{gate.fullAuditFingerprint ?? "-"}</span><br />
        <strong>Baseline reconciliation</strong> · <span className="break-all text-xs">{gate.baselineReconciliationFingerprint ?? "-"}</span><br />
        <strong>Canary token</strong> · <span className="break-all text-xs">{gate.canaryToken ?? "생성 안 됨"}</span><br />
        <strong>실행정책</strong> · 상시 write endpoint는 만들지 않습니다. 실제 mismatch가 생기고 이 gate가 READY가 된 뒤에만 해당 token·externalId·before/after 값을 고정한 일회성 1건 실행기를 별도 검증합니다.
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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
      <strong className="text-slate-950">{label}</strong><br />{value}
    </div>
  );
}
