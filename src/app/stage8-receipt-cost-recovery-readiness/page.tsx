import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { loadReceiptCostRecoveryReadiness } from "@/lib/stage8ReceiptCostRecoveryReadiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function ReceiptCostRecoveryReadinessPage() {
  let report: Awaited<ReturnType<typeof loadReceiptCostRecoveryReadiness>> | null = null;
  let error: string | null = null;
  try {
    report = await loadReceiptCostRecoveryReadiness();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "입고원가 복구 준비도를 읽지 못했습니다.";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · RECEIPT COST RECOVERY"
        title="과거 입고원가 자동복구 준비도"
        description="기존 중국 발주·입고 Worker가 이미 Ops Center로 동기화한 최근 입고원가 캐시와 Canonical 발주후보를 결합합니다. Product Master에 없는 원가 중 자동복구 가능한 범위만 읽기 전용으로 판정하며 이 화면에서는 어떤 원장도 쓰지 않습니다."
        actions={
          <Link
            href="/stage8-inventory-verification-priority"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            재고확인 우선순위
          </Link>
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
            <Metric label="발주후보" value={report.purchaseRecommendationCount} />
            <Metric
              label="PM 원가 없음"
              value={report.purchaseCandidatesMissingProductMasterCost}
            />
            <Metric
              label="캐시 자동복구 가능"
              value={report.purchaseCandidatesRecoverableFromCache}
              good={report.purchaseCandidatesRecoverableFromCache > 0}
            />
            <Metric
              label="캐시 근거 없음"
              value={report.purchaseCandidatesWithoutCacheEvidence}
              warning={report.purchaseCandidatesWithoutCacheEvidence > 0}
            />
            <Metric label="실제 쓰기" value="0 · READ ONLY" />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MoneyMetric label="복구가능 발주금액" value={report.recoverableExpectedSpend} />
            <MoneyMetric label="원가근거 없는 발주금액" value={report.noEvidenceExpectedSpend} />
            <Metric label="캐시 바코드" value={report.cacheBarcodeCount} />
            <Metric label="캐시 입고행" value={report.cacheReceiptCount} />
            <Metric
              label="원가복구 후에도 실사 필요"
              value={report.stocktakeStillRequiredCountAfterCostRecovery}
            />
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-950">
                  CACHE → PRODUCT MASTER 복구 후보
                </h2>
                <p className="mt-1 text-sm text-slate-600">{report.message}</p>
              </div>
              <span className="text-xs font-bold text-emerald-700">
                RECEIPT COST RECOVERY {report.state}
              </span>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[1180px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs font-bold text-slate-500">
                  <tr>
                    <th className="px-3 py-3">바코드</th>
                    <th className="px-3 py-3">상품</th>
                    <th className="px-3 py-3">복구판정</th>
                    <th className="px-3 py-3">캐시 입고</th>
                    <th className="px-3 py-3">최근원가</th>
                    <th className="px-3 py-3">캐시 보호원가</th>
                    <th className="px-3 py-3">예상발주</th>
                    <th className="px-3 py-3">재고 후속</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.rows.map((row) => (
                    <tr key={row.barcode}>
                      <td className="px-3 py-3 font-mono text-xs font-bold">{row.barcode}</td>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-slate-900">{row.name}</div>
                        <div className="text-xs text-slate-400">{row.modelNo ?? "-"}</div>
                      </td>
                      <td className="px-3 py-3 text-xs font-bold">{row.costRecoveryState}</td>
                      <td className="px-3 py-3">{number.format(row.cacheReceiptCount)}</td>
                      <td className="px-3 py-3">{number.format(row.cacheLatestCostKrw)}원</td>
                      <td className="px-3 py-3">{number.format(row.cacheProtectedCostKrw)}원</td>
                      <td className="px-3 py-3">{number.format(row.expectedCost)}원</td>
                      <td className="px-3 py-3 text-xs">
                        {row.stocktakeStillRequiredAfterCostRecovery
                          ? "원가 복구 후 실사 필요"
                          : "재고 기준 확인됨"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 space-y-1 break-all text-xs text-slate-400">
              <p>캐시 complete · {String(report.cacheComplete)}</p>
              <p>캐시 생성 · {report.cacheGeneratedAt ?? "-"}</p>
              <p>캐시 갱신 · {report.cacheUpdatedAt ?? "-"}</p>
              <p>판정 지문 · {report.fingerprint}</p>
              <p>자동 Product Master write · false</p>
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
