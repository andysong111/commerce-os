import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadLegacyVerifiedCostReadiness } from "@/lib/stage8LegacyVerifiedCostReadiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function LegacyVerifiedCostReadinessPage() {
  let report: Awaited<ReturnType<typeof loadLegacyVerifiedCostReadiness>> | null = null;
  let error: string | null = null;
  try {
    report = await loadLegacyVerifiedCostReadiness();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "과거 검증원가 준비도를 읽지 못했습니다.";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · LEGACY VERIFIED COST"
        title="발주전용 과거 검증원가 신뢰도"
        description="확정입고 원장과 별개로, 과거에 검수 완료한 중국 입고원가와 B-code↔모델 매핑이 동시에 명확한 행만 발주비용 신뢰도에 사용합니다. 기존 shadow 추정원가보다 낮은 값은 비용을 낮추지 않으며 가격·재고·확정입고 원장에는 절대 승격하지 않습니다."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/stage8-inventory-verification-priority"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              재고확인 우선순위
            </Link>
            <Link
              href="/stage8-receipt-cost-recovery-readiness"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              입고원가 캐시 상태
            </Link>
          </div>
        }
      />

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-900">
          {error}
        </p>
      ) : report ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Metric label="상태" value={report.state} />
            <Metric label="발주후보" value={report.purchaseCandidateCount} />
            <Metric
              label="과거 검증원가"
              value={report.legacyVerifiedCostCount}
              good={report.legacyVerifiedCostCount > 0}
            />
            <Metric
              label="비용신뢰 후보"
              value={report.costTrustedPurchaseCandidateCount}
              good={report.costTrustedPurchaseCandidateCount > 0}
            />
            <Metric
              label="원가 차단"
              value={report.costBlockedPurchaseCandidateCount}
              warning={report.costBlockedPurchaseCandidateCount > 0}
            />
            <Metric label="실제 쓰기" value="0 · READ ONLY" />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric
              label="즉시 실사 가치 SKU"
              value={report.immediateStocktakeEligibleCount}
              good={report.immediateStocktakeEligibleCount > 0}
            />
            <Metric label="운영가능" value={report.operationallyReadyCount} />
            <MoneyMetric label="전체 shadow 발주금액" value={report.shadowExpectedSpend} />
            <MoneyMetric
              label="비용신뢰 보수발주금액"
              value={report.costTrustedConservativeSpend}
            />
            <MoneyMetric
              label="즉시 실사 대상 보수금액"
              value={report.immediateStocktakeConservativeSpend}
            />
          </section>

          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <h2 className="text-lg font-black text-emerald-950">
              과거 원가를 쓰는 범위는 발주비용 하나뿐입니다
            </h2>
            <p className="mt-2 text-sm leading-6 text-emerald-900">
              {report.message}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-emerald-900">
              <span className="rounded-full bg-white px-3 py-1">가격 사용 {String(report.priceUseAllowed)}</span>
              <span className="rounded-full bg-white px-3 py-1">확정입고 승격 {String(report.confirmedReceiptUseAllowed)}</span>
              <span className="rounded-full bg-white px-3 py-1">재고 write {String(report.inventoryWritesEnabled)}</span>
              <span className="rounded-full bg-white px-3 py-1">business write {String(report.businessWritesEnabled)}</span>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">
                  발주후보 원가 신뢰도
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  비용이 검증된 후보를 위로 올립니다. 이들만 재고실사를 해도 실제 unlock 가능성이 생깁니다.
                </p>
              </div>
              <span className="text-xs text-slate-500">지문 {report.fingerprint}</span>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[1450px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs font-bold text-slate-500">
                  <tr>
                    <th className="px-3 py-3">B-code</th>
                    <th className="px-3 py-3">상품</th>
                    <th className="px-3 py-3">비용신뢰</th>
                    <th className="px-3 py-3">증거 모델/옵션</th>
                    <th className="px-3 py-3">검증원가</th>
                    <th className="px-3 py-3">shadow 원가</th>
                    <th className="px-3 py-3">보수 적용원가</th>
                    <th className="px-3 py-3">권장수량</th>
                    <th className="px-3 py-3">보수 발주금액</th>
                    <th className="px-3 py-3">재고</th>
                    <th className="px-3 py-3">다음 행동</th>
                    <th className="px-3 py-3">원가 기준일</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.rows.map((row) => (
                    <tr key={row.barcode}>
                      <td className="px-3 py-3 font-mono text-xs font-bold">{row.barcode}</td>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-slate-900">{row.name}</div>
                        <div className="text-xs text-slate-400">PM {row.modelNo ?? "-"}</div>
                      </td>
                      <td className="px-3 py-3 text-xs font-black">
                        {row.purchaseCostTrustSource}
                      </td>
                      <td className="px-3 py-3 text-xs">
                        {row.evidenceModelNo ?? "-"} / {row.evidenceOptionName ?? "-"}
                      </td>
                      <td className="px-3 py-3">{number.format(row.evidenceUnitCostKrw)}원</td>
                      <td className="px-3 py-3">{number.format(row.shadowImpliedUnitCostKrw)}원</td>
                      <td className="px-3 py-3 font-bold">{number.format(row.effectivePurchaseUnitCostKrw)}원</td>
                      <td className="px-3 py-3">{number.format(row.recommendedQty)}</td>
                      <td className="px-3 py-3">{number.format(row.effectivePurchaseExpectedCost)}원</td>
                      <td className="px-3 py-3 text-xs">
                        {row.inventoryVerified
                          ? "VERIFIED"
                          : row.inventoryRequiresReview
                            ? "REVIEW"
                            : row.initialZeroUnverified
                              ? "INITIAL_ZERO · UNVERIFIED"
                              : "UNVERIFIED"}
                      </td>
                      <td className="px-3 py-3 text-xs font-bold">
                        {row.operationallyReady
                          ? "운영가능"
                          : row.immediateStocktakeEligible
                            ? "실사하면 unlock 후보"
                            : row.purchaseCostTrusted
                              ? "재고 검토"
                              : "원가 근거 확보 대기"}
                      </td>
                      <td className="px-3 py-3 text-xs">{row.evidenceCostDate ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  good = false,
  warning = false,
}: {
  label: string;
  value: string | number;
  good?: boolean;
  warning?: boolean;
}) {
  const tone = good
    ? "border-emerald-200 bg-emerald-50"
    : warning
      ? "border-amber-200 bg-amber-50"
      : "border-slate-200 bg-white";
  return (
    <article className={`rounded-xl border p-4 ${tone}`}>
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block text-xl text-slate-950">
        {typeof value === "number" ? number.format(value) : value}
      </strong>
    </article>
  );
}

function MoneyMetric({ label, value }: { label: string; value: number }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block text-xl text-slate-950">
        {number.format(value)}원
      </strong>
    </article>
  );
}
