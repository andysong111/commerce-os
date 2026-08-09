import { PageHeader } from "@/components/PageHeader";
import { loadPurchaseCandidateLegacyModelRecovery } from "@/lib/stage8PurchaseCandidateLegacyModelRecovery";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Stage8PurchaseCandidateLegacyModelRecoveryPage() {
  const recovery = await loadPurchaseCandidateLegacyModelRecovery();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · LEGACY MODEL IDENTITY RECOVERY"
        title="발주후보 aaa 모델번호 안전 복구"
        description="현재 발주후보의 LEGACY-* 임시 모델번호를 과거 B-code↔aaa 직접 기록 증거로만 복구합니다. 상품명 유사 추정은 사용하지 않으며 이 화면은 재고·발주·가격을 변경하지 않습니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <Metric label="증거 상태" value={recovery.state} />
        <Metric label="상위 발주상태" value={recovery.upstreamPurchaseState} />
        <Metric label="발주후보" value={`${recovery.purchaseCandidateCount}개`} />
        <Metric label="EXACT 복구" value={`${recovery.recoveredExactCount}개`} />
        <Metric label="미복구" value={`${recovery.unrecoveredCount}개`} />
        <Metric label="충돌" value={`${recovery.conflictCount}개`} />
        <Metric label="Business write" value="0 · READ ONLY" />
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950 shadow-sm">
        <strong>DIRECT EVIDENCE ONLY · NO NAME-ONLY GUESSING</strong>
        <br />
        {recovery.message}
        <br />
        B-code와 aaa 모델번호가 같은 과거 자료 행에 직접 기록된 경우만 과거 발주이력 연결 후보로 엽니다. 과거 발주수량은 여전히 확정입고가 아니며, 이 단계에서 Product Master 모델번호·재고·중국 발주를 수정하지 않습니다.
        <div className="mt-2 text-xs">Fingerprint · {recovery.fingerprint}</div>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-black text-slate-600">
            <tr>
              <th className="px-4 py-3">B-code</th>
              <th className="px-4 py-3">현재 모델번호</th>
              <th className="px-4 py-3">복구 aaa</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3">상품명</th>
              <th className="px-4 py-3">증거</th>
              <th className="px-4 py-3">과거발주 연결</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {recovery.rows.map((row) => (
              <tr key={row.barcode}>
                <td className="px-4 py-3 font-black text-slate-950">{row.barcode}</td>
                <td className="px-4 py-3">{row.currentModelNo ?? "-"}</td>
                <td className="px-4 py-3 font-semibold">{row.recoveredModelNo ?? "-"}</td>
                <td className="px-4 py-3">{row.state}</td>
                <td className="px-4 py-3">{row.productName || "-"}</td>
                <td className="px-4 py-3 text-xs">
                  {row.source
                    ? `${row.source.sourceArtifact} · ${row.source.sourceSheet}`
                    : "DIRECT EVIDENCE NOT FOUND"}
                </td>
                <td className="px-4 py-3 font-semibold">
                  {row.orderHistoryJoinAllowed ? "ELIGIBLE" : "BLOCKED"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
