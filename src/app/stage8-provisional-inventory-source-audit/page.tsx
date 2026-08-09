import { PageHeader } from "@/components/PageHeader";
import { loadProvisionalInventorySourceAudit } from "@/lib/stage8ProvisionalInventorySourceAudit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function ProvisionalInventorySourceAuditPage() {
  const audit = await loadProvisionalInventorySourceAudit();
  const candidates = audit.rows.filter((row) => row.purchaseCandidate);
  const validation = audit.rows.filter(
    (row) => row.physicalValidationQuantity !== null,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · PROVISIONAL INVENTORY SOURCE AUDIT"
        title="추정재고 원천증거 점검"
        description="전수 재고조사 없이 시작하기 위해 과거 입고·판매 수량이 얼마나 남아 있는지 먼저 확인합니다. 이 화면의 입고-판매 차이는 진단값일 뿐 실제 재고로 쓰지 않으며 Product Master 재고도 변경하지 않습니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={audit.state} />
        <Metric label="관리 SKU" value={`${number.format(audit.managedActiveSkuCount)}개`} />
        <Metric label="현재 발주후보" value={`${number.format(audit.purchaseCandidateCount)}개`} />
        <Metric
          label="발주후보 입고증거"
          value={`${number.format(audit.purchaseCandidateWithInboundEvidenceCount)}개`}
        />
        <Metric
          label="발주후보 판매증거"
          value={`${number.format(audit.purchaseCandidateWithSalesHistoryCount)}개`}
        />
        <Metric label="재고 write" value="0 · READ ONLY" />
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
        <span className="text-xs font-black tracking-[0.14em] text-amber-700">
          NO STOCKTAKE REQUIRED · NO INVENTORY PROMOTION YET
        </span>
        <h2 className="mt-1 text-xl font-black text-amber-950">{audit.state}</h2>
        <p className="mt-3 text-sm leading-6 text-amber-900">{audit.message}</p>
        <p className="mt-3 break-all text-xs text-amber-700">
          Source fingerprint · {audit.fingerprint}
        </p>
      </section>

      {validation.length ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <h2 className="text-lg font-black text-emerald-950">실물 검증 표본</h2>
          <p className="mt-2 text-sm leading-6 text-emerald-900">
            아래 실물수량은 추정식의 오차를 확인하는 답안지로만 사용합니다. Product Master 재고나 발주수량에 직접 넣지 않습니다.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {validation.map((row) => (
              <div key={row.barcode} className="rounded-xl bg-white p-4 text-sm text-slate-700">
                <strong className="text-slate-950">{row.barcode}</strong>
                <br />
                실물 {number.format(row.physicalValidationQuantity ?? 0)}개 · 관찰일 {row.physicalValidationObservedOn}
                <br />
                진단 입고-판매 {row.diagnosticNetQuantity === null ? "계산대기" : `${number.format(row.diagnosticNetQuantity)}개`}
                <br />
                오차 {row.validationDeltaUnits === null ? "-" : `${number.format(row.validationDeltaUnits)}개`}
                {row.validationAbsoluteErrorPct === null ? "" : ` · ${row.validationAbsoluteErrorPct.toFixed(2)}%`}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-black text-slate-950">발주후보 원천증거</h2>
            <p className="mt-1 text-sm text-slate-600">
              입고와 판매가 모두 있어도 시작재고 기준이 증명되지 않으면 운영 추정재고로 승격하지 않습니다.
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-500">
            공통증거 {number.format(audit.purchaseCandidateWithBothEvidenceCount)} · 기준 미증명 {number.format(audit.purchaseCandidateBaselineUnprovenCount)} · 입고없음 {number.format(audit.purchaseCandidateNoInboundCount)}
          </span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-2 py-2">B-code</th>
                <th className="px-2 py-2">상태</th>
                <th className="px-2 py-2 text-right">입고 누계</th>
                <th className="px-2 py-2 text-right">판매 누계</th>
                <th className="px-2 py-2 text-right">단순 차이</th>
                <th className="px-2 py-2">입고 범위</th>
                <th className="px-2 py-2">판매 범위</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((row) => (
                <tr key={row.barcode} className="border-b border-slate-100 align-top">
                  <td className="px-2 py-2 font-bold text-slate-950">{row.barcode}</td>
                  <td className="px-2 py-2">{row.evidenceState}</td>
                  <td className="px-2 py-2 text-right">{number.format(row.inboundQuantityTotal)}</td>
                  <td className="px-2 py-2 text-right">{number.format(row.salesQuantityTotal)}</td>
                  <td className="px-2 py-2 text-right">
                    {row.diagnosticNetQuantity === null ? "-" : number.format(row.diagnosticNetQuantity)}
                  </td>
                  <td className="px-2 py-2">{row.firstInboundAt ?? "-"} → {row.lastInboundAt ?? "-"}</td>
                  <td className="px-2 py-2">{row.firstSalesMonth ?? "-"} → {row.lastSalesMonth ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
