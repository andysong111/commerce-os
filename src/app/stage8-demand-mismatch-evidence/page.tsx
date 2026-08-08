import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadDemandMismatchEvidenceStatus } from "@/lib/stage8DemandMismatchEvidence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

const CATEGORY_LABELS: Record<string, string> = {
  LEGACY_ACCEPTS_CANONICAL_IGNORES: "기존 직접집계만 수락 · Canonical 제외",
  LEGACY_ACCEPTS_CANONICAL_UNMAPPED: "기존 직접집계만 수락 · Canonical 연결불가",
  CANONICAL_ONLY_LEGACY_IGNORES: "Canonical만 수락 · 기존 직접집계 제외",
  CANONICAL_ONLY_LEGACY_UNMAPPED: "Canonical만 수락 · 기존 직접집계 연결불가",
  LEGACY_SKU_DIFFERS_FROM_CANONICAL: "같은 주문행의 SKU 귀속 차이",
  LEGACY_QTY_DIFFERS_FROM_CANONICAL: "같은 SKU의 판매수량 차이",
  LEGACY_REVENUE_DIFFERS_FROM_CANONICAL: "같은 SKU의 매출 차이",
};

export default async function Stage8DemandMismatchEvidencePage() {
  const status = await loadDemandMismatchEvidenceStatus();
  const report = status.report;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · DEMAND MISMATCH EVIDENCE"
        title="발주수요 차이 원주문행 진단"
        description="440개 parity 차단 신호를 숫자만 맞추지 않고, 실제 Shopling 주문행 하나씩 기존 직접집계 resolver와 Canonical resolver에 동시에 넣어 어느 규칙에서 차이가 생기는지 분류합니다. 읽기 전용입니다."
        actions={
          <div className="flex gap-2">
            <Link href="/stage8-demand-parity" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              수요 비교
            </Link>
            <Link href="/stage8-canonical-sales-audit" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              판매원장 재검증
            </Link>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={status.state} />
        <Metric label="수집 구간" value={`${status.completedRanges}/${status.totalRanges}`} />
        <Metric label="진행률" value={`${status.progress}%`} />
        <Metric label="진단 대상 SKU" value={number.format(status.targetBarcodes.length)} />
        <Metric label="차이 주문행" value={report ? number.format(report.evidenceRows) : "-"} />
        <Metric label="영향 SKU" value={report ? number.format(report.affectedBarcodes.length) : "-"} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">{status.stage}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">{status.message}</p>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          차이를 발견했다고 Canonical을 기존 방식에 맞춰 수정하지 않습니다. 먼저 주문행 수준에서 어떤 resolver가 왜 다른 값을 만들었는지 증명한 뒤, 잘못된 쪽만 수정하거나 기존 직접집계를 폐기합니다.
        </p>
      </section>

      {report ? (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">원인 분류</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Object.entries(report.categoryCounts).map(([category, count]) => (
                <article key={category} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <span className="text-xs font-semibold text-slate-500">{CATEGORY_LABELS[category] ?? category}</span>
                  <strong className="mt-1 block text-xl text-slate-950">{number.format(count)}행</strong>
                  <p className="mt-2 text-xs text-slate-500">
                    수량 Δ {number.format(report.categoryUnitDelta[category as keyof typeof report.categoryUnitDelta] ?? 0)} · 매출 Δ {number.format(report.categoryRevenueDelta[category as keyof typeof report.categoryRevenueDelta] ?? 0)}원
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">영향도가 큰 주문행</h2>
            <p className="mt-2 text-sm text-slate-600">수량 차이를 우선하고, 같은 수량 차이에서는 매출 차이가 큰 순서입니다. BAA2-1의 1001개 같은 비정상 집계도 여기서 원주문행 단위로 확인할 수 있습니다.</p>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[1600px] text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="px-3 py-2">분류</th>
                    <th className="px-3 py-2">주문번호</th>
                    <th className="px-3 py-2">주문시각</th>
                    <th className="px-3 py-2">상태</th>
                    <th className="px-3 py-2">optionId</th>
                    <th className="px-3 py-2">원본 옵션바코드</th>
                    <th className="px-3 py-2">원본 파트너코드</th>
                    <th className="px-3 py-2">원본 수량</th>
                    <th className="px-3 py-2">Canonical</th>
                    <th className="px-3 py-2">기존 직접집계</th>
                    <th className="px-3 py-2">수량 Δ</th>
                    <th className="px-3 py-2">매출 Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topEvidence.map((row) => (
                    <tr key={`${row.externalId}:${row.category}`} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2 font-bold text-slate-900">{CATEGORY_LABELS[row.category] ?? row.category}</td>
                      <td className="px-3 py-2">{row.orderNo}</td>
                      <td className="px-3 py-2">{row.orderedAt}</td>
                      <td className="px-3 py-2">{row.status || "-"}</td>
                      <td className="px-3 py-2">{row.optionId || "-"}</td>
                      <td className="px-3 py-2 font-semibold">{row.rawOptionBarcode || "-"}</td>
                      <td className="px-3 py-2">{row.rawPartnerCode || "-"}</td>
                      <td className="px-3 py-2">mall_ord_cnt {row.rawMallOrderCount ?? "-"}<br />quantity {row.rawQuantity ?? "-"}<br />정규화 {number.format(row.normalizedQuantity)}</td>
                      <td className="px-3 py-2">{row.canonicalState}<br />{row.canonicalBarcode || "-"}<br />{number.format(row.canonicalUnits)}개 · {number.format(row.canonicalRevenue)}원</td>
                      <td className="px-3 py-2">{row.legacyState}<br />{row.legacyBarcode || "-"}<br />{number.format(row.legacyUnits)}개 · {number.format(row.legacyRevenue)}원</td>
                      <td className="px-3 py-2 font-black">{number.format(row.unitDeltaLegacyMinusCanonical)}</td>
                      <td className="px-3 py-2 font-black">{number.format(row.revenueDeltaLegacyMinusCanonical)}원</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-700">
            <strong>원장 회계</strong> · Shopling 읽은 행 {number.format(report.fetchedRows)} · 후보 주문행 {number.format(report.candidateRows)} · resolver 차이 {number.format(report.evidenceRows)} · 저장 표본 절단 {number.format(report.truncatedEvidenceRows)}<br />
            <strong>Evidence 지문</strong> · <span className="break-all text-xs">{report.evidenceFingerprint}</span><br />
            <strong>안전</strong> · Shopling GET과 Ops operation 원장 기록만 사용합니다. 발주·가격·재고·입고원가·단종은 변경하지 않습니다.
          </section>
        </>
      ) : null}
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
