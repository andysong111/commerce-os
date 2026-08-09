import { PageHeader } from "@/components/PageHeader";
import { loadLegacyOrderSurrogateValidation } from "@/lib/stage8LegacyOrderSurrogateValidation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function Stage8LegacyOrderSurrogateValidationPage() {
  const validation = await loadLegacyOrderSurrogateValidation();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · LEGACY ORDER SURROGATE VALIDATION"
        title="과거 발주수량 기반 추정재고 검증"
        description="과거 중국 발주수량을 확정입고로 간주하지 않고, Canonical 판매원장과 실제 재고 검증 표본을 대조해 추정재고 원천으로 사용할 수 있는지 먼저 확인합니다. 이 화면은 읽기 전용입니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="상태" value={validation.state} />
        <Metric label="검증 표본" value={`${number.format(validation.rowCount)}개`} />
        <Metric label="Canonical 판매" value={validation.canonicalAuditReady ? "READY" : "BLOCKED"} />
        <Metric label="운영 추정재고 승격" value="OFF" />
        <Metric label="재고 write" value="0 · READ ONLY" />
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
        <span className="text-xs font-black tracking-[0.14em] text-amber-700">
          ORDER HISTORY ≠ CONFIRMED RECEIPT
        </span>
        <h2 className="mt-1 text-xl font-black text-amber-950">{validation.state}</h2>
        <p className="mt-3 text-sm leading-6 text-amber-900">{validation.message}</p>
        <p className="mt-3 text-xs text-amber-700">
          analysisAsOf · {validation.analysisAsOf ?? "-"}
        </p>
      </section>

      <section className="space-y-4">
        {validation.rows.map((row) => (
          <article key={row.barcode} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className="text-xs font-bold text-slate-500">{row.modelNumber}</span>
                <h2 className="text-xl font-black text-slate-950">{row.barcode} · {row.productName}</h2>
              </div>
              <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-black text-rose-700">
                {row.conclusion}
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="과거 발주 누계" value={`${number.format(row.cumulativeOrderedQuantity)}개`} />
              <Metric label="Canonical 360일 판매" value={`${number.format(row.canonical360SalesQuantity)}개`} />
              <Metric label="단순 발주-판매" value={`${number.format(row.diagnosticOrderMinusCanonicalSales)}개`} />
              <Metric label="실물 검증" value={row.physicalValidationQuantity === null ? "-" : `${number.format(row.physicalValidationQuantity)}개`} />
            </div>

            <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              <strong>중요:</strong> 단순 발주-판매 {number.format(row.diagnosticOrderMinusCanonicalSales)}개는 실제 재고가 아닙니다.
              {row.diagnosticDeltaToPhysical === null ? null : (
                <> 실물 검증과 차이는 {number.format(row.diagnosticDeltaToPhysical)}개
                  {row.diagnosticAbsoluteErrorPct === null ? "" : ` (${row.diagnosticAbsoluteErrorPct.toFixed(2)}%)`}입니다.</>
              )}
              <br />
              Canonical 범위 · {row.canonicalWindowStart || "-"} → {row.canonicalWindowEnd || "-"}
              <br />
              Product Master 월별 누적 판매 참고값 · {number.format(row.productMasterMonthlySalesQuantity)}개
              <br />
              과거 발주자료 · 최근 발주일 {row.latestOrderDate} · 유효 기록 {row.validOrderRecordCount}건
            </div>

            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-900">
              확정입고 여부: 아니오 · 재고 직접 사용: 금지 · 운영 추정재고 승격: 금지 · 재고 write: 0
            </div>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-xs leading-6 text-slate-600">
        검증 지문 · <span className="break-all">{validation.fingerprint}</span>
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
