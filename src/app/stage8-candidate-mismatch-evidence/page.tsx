import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadCandidateMismatchEvidenceStatus } from "@/lib/stage8CandidateMismatchEvidence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

const CATEGORY_LABELS: Record<string, string> = {
  LEGACY_ACCEPTS_CANONICAL_IGNORES: "기존 직접집계만 수락 · Candidate 제외",
  LEGACY_ACCEPTS_CANONICAL_UNMAPPED: "기존 직접집계만 수락 · Candidate 연결불가",
  CANONICAL_ONLY_LEGACY_IGNORES: "Candidate만 수락 · 기존 직접집계 제외",
  CANONICAL_ONLY_LEGACY_UNMAPPED: "Candidate만 수락 · 기존 직접집계 연결불가",
  LEGACY_SKU_DIFFERS_FROM_CANONICAL: "같은 주문행의 SKU 귀속 차이",
  LEGACY_QTY_DIFFERS_FROM_CANONICAL: "같은 SKU의 판매수량 차이",
  LEGACY_REVENUE_DIFFERS_FROM_CANONICAL: "같은 SKU의 매출 차이",
};

const REASON_LABELS: Record<string, string> = {
  CANONICAL_ORDER_DATE_OUTSIDE_FETCH_RANGE:
    "Shopling 조회구간과 실제 주문일이 달라 날짜 사전필터에서 제외",
  CANONICAL_EXCLUDES_STRUCTURED_NON_MANAGED_OPTION_BARCODE:
    "실제 옵션바코드가 비관리 구조코드라 Candidate가 제외",
  CANONICAL_MANAGED_SCOPE_FALSE:
    "Candidate 관리 SKU 증거가 없어 제외",
  CANONICAL_OTHER_SCOPE_EXCLUSION:
    "Candidate의 다른 관리범위 제외 조건",
  CANONICAL_HISTORICAL_BARCODE_LEGACY_ACTIVE_ONLY:
    "Candidate는 비활성 관리 SKU 역사 바코드를 보존하지만 기존 직접집계는 활성 SKU만 조회",
  LEGACY_ACTIVE_IDENTITY_MISSING:
    "Candidate는 안전하게 연결했지만 기존 직접집계의 활성 identity에 없음",
  RESOLVER_SKU_PRECEDENCE_DIFFERENCE: "두 resolver의 SKU 증거 우선순위 차이",
  RESOLVER_QUANTITY_RULE_DIFFERENCE: "두 resolver의 판매수량 환산 규칙 차이",
  RESOLVER_REVENUE_RULE_DIFFERENCE: "두 resolver의 매출 계산 규칙 차이",
};

export default async function Stage8CandidateMismatchEvidencePage() {
  const status = await loadCandidateMismatchEvidenceStatus();
  const report = status.report;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · PRE-WRITE MISMATCH EVIDENCE"
        title="쓰기 전 Candidate 차이 원주문행 진단"
        description="Product Master에 적재하기 전 candidate parity에 남은 SKU만 실제 Shopling 주문행을 두 resolver에 동시에 넣어 차이 원인을 분류합니다. 이 화면과 작업은 읽기 전용입니다."
        actions={
          <div className="flex gap-2">
            <Link href="/stage8-candidate-demand-parity" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              Candidate 수요 비교
            </Link>
            <Link href="/stage8-sales-events" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              판매 이벤트 후보
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
          Candidate가 기존 직접집계보다 더 많은 판매를 잡는다고 자동으로 허용하지 않습니다. 원주문행별로 안전한 historical identity 보완인지, 기존 방식이 놓친 활성 identity인지, 계산 규칙 차이인지 먼저 증명합니다.
        </p>
      </section>

      {report ? (
        <>
          <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">원인별 회계</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Object.entries(report.reasonCounts).map(([reason, count]) => (
                <article key={reason} className="rounded-xl border border-indigo-100 bg-white p-4">
                  <span className="text-xs font-semibold leading-5 text-slate-600">{REASON_LABELS[reason] ?? reason}</span>
                  <strong className="mt-1 block text-xl text-slate-950">{number.format(count)}행</strong>
                  <p className="mt-2 text-xs text-slate-500">
                    기존−Candidate 수량 Δ {number.format(report.reasonUnitDelta[reason as keyof typeof report.reasonUnitDelta] ?? 0)} · 매출 Δ {number.format(report.reasonRevenueDelta[reason as keyof typeof report.reasonRevenueDelta] ?? 0)}원
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">Resolver 결과 분류</h2>
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
            <h2 className="text-lg font-black text-slate-950">영향 주문행</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[2000px] text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="px-3 py-2">원인</th>
                    <th className="px-3 py-2">분류</th>
                    <th className="px-3 py-2">주문번호</th>
                    <th className="px-3 py-2">주문시각</th>
                    <th className="px-3 py-2">상태</th>
                    <th className="px-3 py-2">optionId</th>
                    <th className="px-3 py-2">원본 옵션바코드</th>
                    <th className="px-3 py-2">원본 파트너코드</th>
                    <th className="px-3 py-2">원본 수량</th>
                    <th className="px-3 py-2">Candidate</th>
                    <th className="px-3 py-2">기존 직접집계</th>
                    <th className="px-3 py-2">기존−Candidate 수량 Δ</th>
                    <th className="px-3 py-2">매출 Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topEvidence.map((row) => (
                    <tr key={`${row.externalId}:${row.category}`} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2 font-bold text-indigo-900">{REASON_LABELS[row.reason] ?? row.reason}</td>
                      <td className="px-3 py-2 font-bold text-slate-900">{CATEGORY_LABELS[row.category] ?? row.category}</td>
                      <td className="px-3 py-2">{row.orderNo}</td>
                      <td className="px-3 py-2">{row.orderedAt}</td>
                      <td className="px-3 py-2">{row.status || "-"}</td>
                      <td className="px-3 py-2">{row.optionId || "-"}</td>
                      <td className="px-3 py-2">{row.rawOptionBarcode || "-"}</td>
                      <td className="px-3 py-2">{row.rawPartnerCode || "-"}</td>
                      <td className="px-3 py-2">mall_ord_cnt {row.rawMallOrderCount ?? "-"}<br />정규화 {number.format(row.normalizedQuantity)}</td>
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
            <strong>안전</strong> · Shopling GET과 Ops operation evidence만 사용합니다. Product Master 판매원장·발주·가격·재고·입고원가·단종은 변경하지 않습니다.
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
