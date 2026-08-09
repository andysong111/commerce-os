import { PageHeader } from "@/components/PageHeader";
import { loadProvenSkuSalesGapLiveAudit } from "@/lib/stage8ProvenSkuSalesGapLiveAudit";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

const number = new Intl.NumberFormat("ko-KR");

export default async function Stage8ProvenSkuSalesGapLiveAuditPage() {
  const audit = await loadProvenSkuSalesGapLiveAudit();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · PROVEN SKU SALES GAP LIVE AUDIT"
        title="Canonical 이전 판매공백 · Shopling 읽기 전용 재조회"
        description="최신 과거발주 차감 시작일이 exact Canonical 이벤트보다 앞선 증명 SKU만 골라, 그 사이 판매를 Shopling 주문 API에서 제한적으로 다시 읽습니다. 현재 B-code·goods_key·option으로 직접 식별되는 판매만 사용합니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <Metric label="상태" value={audit.state} />
        <Metric label="대상 SKU" value={`${audit.targetCount}개`} />
        <Metric label="API 구간" value={`${audit.completedGlobalRangeCount}/${audit.globalRangeCount}`} />
        <Metric label="식별 깨끗" value={`${audit.identityCleanCount}개`} />
        <Metric label="미해결" value={`${audit.unresolvedCount}개`} />
        <Metric label="조정후보" value={`${audit.adjustedResidualCandidateCount}개`} />
        <Metric label="Business write" value="0 · READ ONLY" />
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950 shadow-sm">
        <strong>BOUNDED SHOPLING READ · NO INVENTORY PROMOTION</strong>
        <br />
        {audit.message}
        <br />
        조회범위 · {audit.globalScanStart ?? "-"} → {audit.globalScanEnd ?? "-"} · 조회행 {number.format(audit.fetchedRows)}
        <br />
        조정된 최신 잔여후보도 여전히 PROVISIONAL 진단값일 뿐 실제재고가 아닙니다. 실제 중국 발주나 Product Master 재고 write는 수행하지 않습니다.
        <div className="mt-2 break-all text-xs">Fingerprint · {audit.fingerprint}</div>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-black text-slate-600">
            <tr>
              <th className="px-4 py-3">B-code</th>
              <th className="px-4 py-3">aaa</th>
              <th className="px-4 py-3">Gap</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3">Gap 직접판매</th>
              <th className="px-4 py-3">Canonical 이후판매</th>
              <th className="px-4 py-3">최신발주</th>
              <th className="px-4 py-3">조정 최신 잔여후보</th>
              <th className="px-4 py-3">모호성</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {audit.targets.map((row) => (
              <tr key={row.barcode}>
                <td className="px-4 py-3 font-black text-slate-950">{row.barcode}</td>
                <td className="px-4 py-3 font-semibold">{row.modelNo}</td>
                <td className="px-4 py-3 text-xs">{row.deductionStartDate} → {row.scanEndDate}</td>
                <td className="px-4 py-3 font-semibold">{row.state}</td>
                <td className="px-4 py-3">{number.format(row.currentIdentityGapUnits)}개</td>
                <td className="px-4 py-3">{number.format(row.canonicalSalesAfterGap)}개</td>
                <td className="px-4 py-3">{number.format(row.latestOrderQuantity)}개</td>
                <td className="px-4 py-3 font-black">
                  {row.adjustedLatestResidualCandidate === null
                    ? "BLOCKED"
                    : `${number.format(row.adjustedLatestResidualCandidate)}개`}
                </td>
                <td className="px-4 py-3 text-xs leading-5">
                  aaa-only {number.format(row.legacyModelWithoutCurrentIdentityRows)}행
                  <br />
                  foreign B-code {number.format(row.foreignBcodeConflictRows)}행
                  <br />
                  pack 미해결 {number.format(row.unresolvedPackRows)}행
                  <br />
                  구간 {row.completedRangeCount}/{row.requiredRangeCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-700 shadow-sm">
        <strong className="text-slate-950">사용 조건</strong>
        <br />
        필요한 모든 날짜구간 조회가 성공하고, 현재 identity 없이 aaa 코드만 남은 주문행·외부 B-code 충돌·세트수량 미해결 행이 모두 0일 때만 IDENTITY_CLEAN입니다. 그 경우에도 gap 판매량은 다음 추정재고 진단의 차감 근거로만 사용할 수 있고 실제재고 승격은 금지합니다.
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
