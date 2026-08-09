import { PageHeader } from "@/components/PageHeader";
import { loadProvisionalDecisionEvidenceGate } from "@/lib/stage8ProvisionalDecisionEvidenceGate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function Stage8ProvisionalDecisionEvidenceGatePage() {
  const gate = await loadProvisionalDecisionEvidenceGate();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · PROVISIONAL DECISION EVIDENCE GATE"
        title="추정재고 발주 실행증거 게이트"
        description="전수 재고조사 없이 운영하되 PROVISIONAL 한 점 추정값만으로 실제 발주 Draft가 열리지 않도록, 불확실성 밴드 양끝에서 발주 방향이 안정적인지 별도로 판정합니다. 이 화면은 읽기 전용입니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={gate.state} />
        <Metric label="평가 SKU" value={`${number.format(gate.evaluatedCount)}개`} />
        <Metric label="Draft 증거 준비" value={`${number.format(gate.draftEvidenceReadyCount)}개`} />
        <Metric label="Hold 증거 준비" value={`${number.format(gate.holdEvidenceReadyCount)}개`} />
        <Metric label="재고 민감" value={`${number.format(gate.inventorySensitiveCount)}개`} />
        <Metric label="증거 부족" value={`${number.format(gate.insufficientEvidenceCount)}개`} />
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        <strong>PROVISIONAL ≠ VERIFIED · ACTUAL DRAFT WRITE 0</strong>
        <p className="mt-2">{gate.message}</p>
        <p className="mt-2 text-xs break-all">Source fingerprint · {gate.sourceFingerprint}</p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold text-slate-600">
              <tr>
                <th className="px-4 py-3">B-code</th>
                <th className="px-4 py-3">aaa</th>
                <th className="px-4 py-3">상품</th>
                <th className="px-4 py-3">증거 상태</th>
                <th className="px-4 py-3">재고 밴드</th>
                <th className="px-4 py-3">발주 시뮬레이션</th>
                <th className="px-4 py-3">보수 Draft</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {gate.rows.map((row) => (
                <tr key={row.barcode} className="align-top">
                  <td className="px-4 py-3 font-black text-slate-950">{row.barcode}</td>
                  <td className="px-4 py-3">{row.modelNo ?? "-"}</td>
                  <td className="px-4 py-3 min-w-64">
                    <div className="font-semibold text-slate-900">{row.productName}</div>
                    <div className="mt-1 max-w-xl text-xs leading-5 text-slate-500">{row.reason}</div>
                  </td>
                  <td className="px-4 py-3 font-bold">{row.state}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {row.diagnosticLowQuantity === null || row.diagnosticHighQuantity === null
                      ? "-"
                      : `${number.format(row.diagnosticLowQuantity)} ~ ${number.format(row.diagnosticHighQuantity)}`}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {row.lowRecommendedQuantity === null || row.highRecommendedQuantity === null
                      ? "-"
                      : `${number.format(row.lowRecommendedQuantity)} / ${number.format(row.highRecommendedQuantity)}`}
                  </td>
                  <td className="px-4 py-3 font-bold whitespace-nowrap">
                    {row.draftEvidenceReady
                      ? `${number.format(row.conservativeDraftRecommendedQuantity)}개 · EVIDENCE ONLY`
                      : "OFF"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
        <strong className="text-slate-950">안전 규칙</strong>
        <br />
        양끝 모두 발주일 때만 더 작은 권장수량을 Draft 증거 후보로 표시합니다. 양끝 모두 보류면 Hold 판단만 안정적으로 인정합니다. 발주/보류가 갈리거나 과거 판매·발주 정체성 증거가 부족하면 차단합니다. 어느 경우에도 이 단계가 중국 발주서 생성, 결제, Product Master 재고 승격을 직접 실행하지 않습니다.
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
