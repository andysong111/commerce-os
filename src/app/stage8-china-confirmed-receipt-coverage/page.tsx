import { PageHeader } from "@/components/PageHeader";
import { loadChinaConfirmedReceiptCoverage } from "@/lib/stage8ChinaConfirmedReceiptCoverage";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

const number = new Intl.NumberFormat("ko-KR");

export default async function ChinaConfirmedReceiptCoveragePage() {
  const report = await loadChinaConfirmedReceiptCoverage();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · CHINA CONFIRMED RECEIPT COVERAGE"
        title="발주후보 중국 확정입고 원장 직접대조"
        description="중국 발주·입고 관리의 확정입고 API 전체 이력을 현재 42개 발주후보 B-code와 Product Master receipt 원장에 직접 대조합니다. 중국 원장에 있는데 Product Master에 없는 확정입고가 있는지 찾는 읽기 전용 감사입니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={report.state} />
        <Metric label="중국 source rows" value={number.format(report.sourceReceiptRowCount)} />
        <Metric label="중국 source 수량" value={number.format(report.sourceReceiptQuantity)} />
        <Metric label="발주후보" value={number.format(report.purchaseCandidateCount)} />
        <Metric label="후보 중국입고 있음" value={number.format(report.candidateWithChinaReceiptCount)} />
        <Metric label="후보 PM receipt 있음" value={number.format(report.candidateWithProductMasterReceiptCount)} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="SOURCE_SYNC_GAP" value={number.format(report.sourceSyncGapCount)} />
        <Metric label="수량불일치" value={number.format(report.quantityMismatchCount)} />
        <Metric label="PARITY" value={number.format(report.parityCount)} />
        <Metric label="확정입고 없음" value={number.format(report.noConfirmedReceiptCount)} />
        <Metric label="비후보 source rows" value={number.format(report.nonCandidateReceiptRowCount)} />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${report.state === "READY_READ_ONLY" ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-slate-500">CHINA RECEIPT SOURCE · {report.sourceMode || "-"} · READ ONLY</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{report.state}</h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">PURCHASE / INVENTORY WRITE 0</strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{report.message}</p>
        <p className="mt-2 text-xs text-slate-500">Source pages · {number.format(report.sourcePageCount)}</p>
        <p className="mt-1 break-all text-xs text-slate-500">Fingerprint · {report.fingerprint}</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1800px] text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="px-3 py-2">B-code</th>
                <th className="px-3 py-2">상품명</th>
                <th className="px-3 py-2">판정</th>
                <th className="px-3 py-2">중국 receipt rows</th>
                <th className="px-3 py-2">중국 입고수량</th>
                <th className="px-3 py-2">batch</th>
                <th className="px-3 py-2">source model</th>
                <th className="px-3 py-2">첫 입고</th>
                <th className="px-3 py-2">최근 입고</th>
                <th className="px-3 py-2">최근 단위원가</th>
                <th className="px-3 py-2">최고 단위원가</th>
                <th className="px-3 py-2">PM receipt 수량</th>
                <th className="px-3 py-2">PM receipt rows</th>
                <th className="px-3 py-2">메시지</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.barcode} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 font-mono font-black text-slate-950">{row.barcode}</td>
                  <td className="px-3 py-2 font-bold">{row.productName}</td>
                  <td className="px-3 py-2 font-black">{row.state}</td>
                  <td className="px-3 py-2">{number.format(row.chinaReceiptRowCount)}</td>
                  <td className="px-3 py-2 font-black">{number.format(row.chinaReceiptQuantity)}</td>
                  <td className="px-3 py-2 font-mono">{row.chinaReceiptBatchIds.join(" / ") || "-"}</td>
                  <td className="px-3 py-2 font-mono">{row.chinaReceiptModelNumbers.join(" / ") || "-"}</td>
                  <td className="px-3 py-2">{row.firstChinaReceiptAt ?? "-"}</td>
                  <td className="px-3 py-2">{row.latestChinaReceiptAt ?? "-"}</td>
                  <td className="px-3 py-2">{row.latestChinaUnitCostKrw ? `${number.format(row.latestChinaUnitCostKrw)}원` : "-"}</td>
                  <td className="px-3 py-2">{row.maxChinaUnitCostKrw ? `${number.format(row.maxChinaUnitCostKrw)}원` : "-"}</td>
                  <td className="px-3 py-2">{number.format(row.productMasterReceiptQuantity)}</td>
                  <td className="px-3 py-2">{number.format(row.productMasterReceiptRowCount)}</td>
                  <td className="px-3 py-2 text-slate-500">{row.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        <strong>확정입고가 있다고 초기 미확인 재고가 자동으로 정확해지는 것은 아닙니다.</strong><br />
        이 감사의 목적은 중국 입고원장의 정확한 수량·원가 증거가 Product Master에 빠져 있는지 확인하는 것입니다. `SOURCE_SYNC_GAP`이 있어도 원인 대조와 안전한 동기화 경로를 먼저 만들며, 이 화면은 Product Master 재고승격이나 실제 중국발주를 실행하지 않습니다.
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
