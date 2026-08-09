import { PageHeader } from "@/components/PageHeader";
import { loadFullCoverageHistoricalOrderEvidence } from "@/lib/stage8FullCoverageHistoricalOrderEvidence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function FullCoverageHistoricalOrderEvidencePage() {
  const report = await loadFullCoverageHistoricalOrderEvidence();
  const readyRows = report.rows.filter(
    (row) => row.state === "ORDER_HISTORY_READY_NOT_INBOUND",
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · FULL-COVERAGE HISTORICAL ORDER EVIDENCE"
        title="완전증거 모델의 과거 중국발주이력 연결"
        description="현재 Shopling goods_key 전체가 하나의 원본 aaa 모델로 증명된 B-code에만 과거 중국 발주수량·날짜·원가를 연결합니다. ORDER HISTORY는 확정입고나 현재재고가 아니며, 이 화면에서는 추정재고 승격이나 실제 발주판단을 하지 않습니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={report.state} />
        <Metric label="발주후보" value={number.format(report.purchaseCandidateCount)} />
        <Metric label="단일모델 완전증거" value={number.format(report.singleModelFullCoverageCount)} />
        <Metric label="발주이력 연결 준비" value={number.format(report.orderHistoryReadyCount)} />
        <Metric label="발주이력 없음" value={number.format(report.noOrderEvidenceCount)} />
        <Metric label="모델 불일치" value={number.format(report.modelCrosswalkMismatchCount)} />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${report.state === "READY_READ_ONLY" ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-slate-500">ORDER HISTORY ≠ CONFIRMED INBOUND ≠ CURRENT INVENTORY</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{report.state}</h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">PURCHASE / INVENTORY WRITE 0</strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{report.message}</p>
        <p className="mt-2 break-all text-xs text-slate-500">Fingerprint · {report.fingerprint}</p>
      </section>

      {readyRows.length ? (
        <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-black text-slate-950">PROVISIONAL 입력증거 준비 완료</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              아래 수량은 과거 주문기록이며 실제 입고수량이나 현재 창고재고가 아닙니다. 다음 단계의 보수적 추정식 입력으로만 사용할 수 있습니다.
            </p>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {readyRows.map((row) => (
              <article key={row.barcode} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm font-black text-slate-950">{row.barcode}</p>
                    <h3 className="mt-1 text-lg font-black text-slate-950">{row.productName}</h3>
                    <p className="mt-1 font-mono text-xs text-slate-500">{row.originalModelNos.join(" / ")}</p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">{row.state}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <MiniMetric label="누적 주문" value={`${number.format(row.cumulativeOrderQuantity ?? 0)}개`} />
                  <MiniMetric label="최근 3회" value={`${number.format(row.recentThreeOrderQuantity ?? 0)}개`} />
                  <MiniMetric label="최근 발주일" value={row.latestOrderDate ?? "-"} />
                  <MiniMetric label="최근 발주량" value={`${number.format(row.latestOrderQuantity ?? 0)}개`} />
                  <MiniMetric label="최근 옵션행" value={`${number.format(row.latestOrderOptionCount)}개`} />
                  <MiniMetric label="가중 단위원가" value={row.latestOrderWeightedUnitCostKrw === null ? "-" : `${number.format(row.latestOrderWeightedUnitCostKrw)}원`} />
                  <MiniMetric label="최저 단위원가" value={row.latestOrderMinUnitCostKrw === null ? "-" : `${number.format(row.latestOrderMinUnitCostKrw)}원`} />
                  <MiniMetric label="최고 단위원가" value={row.latestOrderMaxUnitCostKrw === null ? "-" : `${number.format(row.latestOrderMaxUnitCostKrw)}원`} />
                </div>
                <p className="mt-4 text-xs leading-5 text-slate-500">
                  Source · {row.sourceArtifact ?? "-"} · {row.sourceSheets.join(" / ") || "-"}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1500px] text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="px-3 py-2">B-code</th>
                <th className="px-3 py-2">상품명</th>
                <th className="px-3 py-2">교차검증</th>
                <th className="px-3 py-2">원본 aaa</th>
                <th className="px-3 py-2">발주이력 상태</th>
                <th className="px-3 py-2">누적주문</th>
                <th className="px-3 py-2">최근3회</th>
                <th className="px-3 py-2">최근발주일</th>
                <th className="px-3 py-2">최근발주량</th>
                <th className="px-3 py-2">추정식 입력</th>
                <th className="px-3 py-2">메시지</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.barcode} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 font-mono font-black text-slate-950">{row.barcode}</td>
                  <td className="px-3 py-2 font-bold">{row.productName}</td>
                  <td className="px-3 py-2 font-black">{row.crosswalkState}</td>
                  <td className="px-3 py-2 font-mono">{row.originalModelNos.join(" / ") || "-"}</td>
                  <td className="px-3 py-2 font-black">{row.state}</td>
                  <td className="px-3 py-2">{row.cumulativeOrderQuantity === null ? "-" : number.format(row.cumulativeOrderQuantity)}</td>
                  <td className="px-3 py-2">{row.recentThreeOrderQuantity === null ? "-" : number.format(row.recentThreeOrderQuantity)}</td>
                  <td className="px-3 py-2">{row.latestOrderDate ?? "-"}</td>
                  <td className="px-3 py-2">{row.latestOrderQuantity === null ? "-" : number.format(row.latestOrderQuantity)}</td>
                  <td className="px-3 py-2 font-black">{row.provisionalEstimateInputEligible ? "EVIDENCE READY" : "BLOCKED"}</td>
                  <td className="px-3 py-2 text-slate-500">{row.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        <strong>발주이력 연결은 재고확정이 아닙니다.</strong><br />
        `ORDER_HISTORY_READY_NOT_INBOUND`는 과거 주문수량을 안전하게 읽을 수 있다는 뜻뿐입니다. 실제 입고 여부와 당시 시작재고를 증명하지 못하므로 현재재고로 기록하지 않습니다. 다음 단계에서도 Canonical 판매와 결합한 PROVISIONAL 후보만 만들고 Product Master 재고승격·중국 발주·가격변경은 계속 차단합니다.
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

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className="mt-1 break-all text-sm font-black text-slate-950">{value}</p>
    </div>
  );
}
