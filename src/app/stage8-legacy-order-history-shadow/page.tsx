import { PageHeader } from "@/components/PageHeader";
import { loadLegacyOrderHistoryJoinShadow } from "@/lib/stage8LegacyOrderHistoryJoinShadow";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function Stage8LegacyOrderHistoryShadowPage() {
  const shadow = await loadLegacyOrderHistoryJoinShadow();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · LEGACY ORDER HISTORY SHADOW"
        title="과거 중국 발주이력 읽기 전용 연결"
        description="복구된 aaa 모델번호와 과거 중국 발주이력을 B-code별로 연결합니다. 주문수량은 추정재고 계산을 위한 후보 증거일 뿐 확정입고나 현재 재고로 간주하지 않습니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="증거상태" value={shadow.state} />
        <Metric label="복구 정체성" value={`${shadow.recoveredIdentityCount}개`} />
        <Metric label="완전연결" value={`${shadow.joinedCompleteCount}개`} />
        <Metric label="누적만 연결" value={`${shadow.joinedCumulativeOnlyCount}개`} />
        <Metric label="최신수량 사용가능" value={`${shadow.latestOrderScenarioEligibleCount}개`} />
        <Metric label="Business write" value="0 · READ ONLY" />
      </section>

      <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm leading-6 text-rose-950 shadow-sm">
        <strong>ORDER HISTORY ≠ CONFIRMED INBOUND ≠ CURRENT INVENTORY</strong>
        <br />
        {shadow.message}
        <br />
        상위 발주 실행 상태는 <strong>{shadow.upstreamPurchaseState}</strong>이며 이 화면과 별도로 유지됩니다. 이 단계에서는 Product Master 재고 승격, 중국 발주 생성, 가격 또는 Shopling 변경을 하지 않습니다.
        <div className="mt-2 text-xs">Fingerprint · {shadow.fingerprint}</div>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-black text-slate-600">
            <tr>
              <th className="px-4 py-3">B-code</th>
              <th className="px-4 py-3">aaa</th>
              <th className="px-4 py-3">상품명</th>
              <th className="px-4 py-3">연결상태</th>
              <th className="px-4 py-3">누적 발주</th>
              <th className="px-4 py-3">최신일</th>
              <th className="px-4 py-3">최신 1회</th>
              <th className="px-4 py-3">제외/미배정</th>
              <th className="px-4 py-3">사용범위</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shadow.rows.map((row) => (
              <tr key={row.barcode}>
                <td className="px-4 py-3 font-black text-slate-950">{row.barcode}</td>
                <td className="px-4 py-3 font-semibold">{row.effectiveModelNo ?? "-"}</td>
                <td className="px-4 py-3">{row.productName || "-"}</td>
                <td className="px-4 py-3">{row.state}</td>
                <td className="px-4 py-3">
                  {row.safeCumulativeOrderQuantity === null
                    ? "-"
                    : `${number.format(row.safeCumulativeOrderQuantity)}개`}
                </td>
                <td className="px-4 py-3">{row.latestSafeOrderDate ?? "-"}</td>
                <td className="px-4 py-3">
                  {row.latestOrderScenarioEligible && row.latestSafeOrderQuantity !== null
                    ? `${number.format(row.latestSafeOrderQuantity)}개`
                    : row.evidence?.latestOrderEvidenceState === "NEEDS_EXACT_ROW"
                      ? "NEEDS EXACT ROW"
                      : "-"}
                </td>
                <td className="px-4 py-3 text-xs">
                  {row.evidence
                    ? `모호 ${number.format(row.evidence.excludedAmbiguousQuantity)} / 기타옵션 ${number.format(row.evidence.unmappedOtherOptionQuantity)}`
                    : "-"}
                </td>
                <td className="px-4 py-3 text-xs font-semibold">
                  누적 {row.cumulativeScenarioEligible ? "ELIGIBLE" : "BLOCKED"}
                  <br />
                  최신 {row.latestOrderScenarioEligible ? "ELIGIBLE" : "BLOCKED"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        <strong>aaa045 옵션 분리 안전규칙</strong>
        <br />
        BGE1-1 블랙 누적 825개, BGE2-1 그레이 누적 870개만 연결합니다. 상품명에는 블랙이지만 옵션이 그레이인 30개는 양쪽 모두 제외하고, 화이트 60개도 어느 B-code에도 배정하지 않습니다. 합계 검산은 825 + 870 + 30 + 60 = 1,785개입니다.
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
