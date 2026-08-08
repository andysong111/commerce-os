import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadCandidatePromotionGate } from "@/lib/stage8CandidatePromotionGate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Stage8CandidatePromotionGatePage() {
  const gate = await loadCandidatePromotionGate();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · PRE-WRITE PROMOTION GATE"
        title="Canonical 판매원장 적재 승인 게이트"
        description="쓰기 전 candidate parity와 원주문행 evidence를 같은 요청·지문으로 묶어 검증합니다. 완전일치 또는 증명된 Candidate-only identity 보완만 canary/full 적재를 허용합니다."
        actions={
          <div className="flex gap-2">
            <Link href="/stage8-candidate-demand-parity" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              Candidate 수요 비교
            </Link>
            <Link href="/stage8-candidate-mismatch-evidence" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              차이 원주문행
            </Link>
          </div>
        }
      />

      <section className={`rounded-2xl border p-5 shadow-sm ${gate.safeToApply ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-bold tracking-wide text-slate-500">상태</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{gate.state}</h2>
          </div>
          <strong className={`rounded-full px-4 py-2 text-sm ${gate.safeToApply ? "bg-emerald-700 text-white" : "bg-amber-700 text-white"}`}>
            {gate.safeToApply ? "CANARY 적재 허용" : "PRODUCT MASTER WRITE 차단"}
          </strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{gate.message}</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">Fail-closed 검증 항목</h2>
        <div className="mt-4 space-y-2">
          {gate.checks.map((row) => (
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

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
        <strong>Candidate sales request</strong> · {gate.candidateSalesRequestId ?? "-"}<br />
        <strong>Candidate plan</strong> · <span className="break-all text-xs">{gate.candidatePlanFingerprint ?? "-"}</span><br />
        <strong>Candidate event</strong> · <span className="break-all text-xs">{gate.candidateEventFingerprint ?? "-"}</span><br />
        <strong>Candidate parity</strong> · <span className="break-all text-xs">{gate.candidateParityFingerprint ?? "-"}</span><br />
        <strong>Mismatch evidence</strong> · <span className="break-all text-xs">{gate.evidenceFingerprint ?? "-"}</span><br />
        <strong>Promotion fingerprint</strong> · <span className="break-all text-xs">{gate.promotionFingerprint ?? "-"}</span><br />
        <strong>쓰기 정책</strong> · 이 게이트가 PASS하지 않으면 동일 planFingerprint와 CANARY/FULL 확인값을 보내도 판매 이벤트 API가 409로 차단합니다.
      </section>
    </div>
  );
}
