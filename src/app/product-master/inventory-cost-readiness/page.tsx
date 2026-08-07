import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import {
  loadProductMasterInventoryCostReadiness,
  productMasterInventoryCostReadinessConfigured,
  type ProductMasterInventoryCostReadiness,
} from "@/lib/productMasterInventoryCostReadiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function ProductMasterInventoryCostReadinessPage() {
  const configured = productMasterInventoryCostReadinessConfigured();
  let report: ProductMasterInventoryCostReadiness | null = null;
  let error: string | null = null;
  if (configured) {
    try {
      report = await loadProductMasterInventoryCostReadiness();
    } catch (caught) {
      error =
        caught instanceof Error
          ? caught.message
          : "상품마스터 재고·원가 상태를 불러오지 못했습니다.";
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · PRODUCT MASTER · STAGE 7"
        title="재고·입고원가 신뢰도"
        description="관리 B-code SKU의 재고 기준점과 확정 입고원가 원장을 전체 페이지네이션으로 읽어, 발주·가격 엔진에 넘길 수 있는지 확인합니다. 초기 0·미확인은 품절이 아니라 미확인 상태로 유지합니다."
        actions={
          <Link
            href="/product-master"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            상품마스터 구축현황
          </Link>
        }
      />

      {!configured ? (
        <Status tone="amber" text="Product Master 연동 설정이 필요합니다." />
      ) : error ? (
        <Status tone="rose" text={error} />
      ) : report ? (
        <ReadinessView report={report} />
      ) : null}
    </div>
  );
}

function ReadinessView({ report }: { report: ProductMasterInventoryCostReadiness }) {
  const summary = report.summary;
  const receiptCoverage = summary.managedActiveSkuCount
    ? Math.round(
        (summary.confirmedReceiptCostSkuCount / summary.managedActiveSkuCount) * 100,
      )
    : 0;
  const inventoryCoverage = summary.managedActiveSkuCount
    ? Math.round(
        (summary.inventoryVerifiedCount / summary.managedActiveSkuCount) * 100,
      )
    : 0;
  const reviewRows = report.rows.filter(
    (row) =>
      row.inventoryRequiresReview ||
      row.initialZeroUnverified ||
      !row.hasConfirmedReceiptCost,
  );

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="관리 활성 SKU" value={summary.managedActiveSkuCount} />
        <Metric
          label="확인 재고"
          value={summary.inventoryVerifiedCount}
          note={`${inventoryCoverage}%`}
        />
        <Metric
          label="초기 0·미확인"
          value={summary.initialZeroUnverifiedCount}
          warning={summary.initialZeroUnverifiedCount > 0}
        />
        <Metric
          label="재고 검토"
          value={summary.inventoryReviewCount}
          danger={summary.inventoryReviewCount > 0}
        />
        <Metric
          label="확정원가 SKU"
          value={summary.confirmedReceiptCostSkuCount}
          note={`${receiptCoverage}%`}
        />
        <Metric
          label="원가 미보유"
          value={summary.missingConfirmedReceiptCostSkuCount}
          warning={summary.missingConfirmedReceiptCostSkuCount > 0}
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="재고 이동 원장" value={summary.inventoryMovementRowCount} />
        <Metric label="입고원가 원장" value={summary.receiptCostRowCount} />
        <Metric
          label="INBOUND 이벤트"
          value={summary.movementKindCounts.INBOUND ?? 0}
        />
        <Metric
          label="실사 기준"
          value={summary.movementKindCounts.STOCKTAKE ?? 0}
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">신뢰도 보완 대상</h2>
            <p className="mt-1 text-sm text-slate-500">
              재고 미확인·검토 또는 확정 입고원가가 없는 관리 SKU만 표시합니다.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            {new Date(report.generatedAt).toLocaleString("ko-KR")} · {number.format(reviewRows.length)}개
          </p>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[980px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs font-bold text-slate-500">
              <tr>
                <th className="px-3 py-3">위치코드</th>
                <th className="px-3 py-3">추정재고</th>
                <th className="px-3 py-3">재고상태</th>
                <th className="px-3 py-3">이동원장</th>
                <th className="px-3 py-3">입고원가</th>
                <th className="px-3 py-3">최신원가</th>
                <th className="px-3 py-3">보호원가</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reviewRows.slice(0, 500).map((row) => (
                <tr key={row.skuId}>
                  <td className="px-3 py-3 font-mono text-xs font-bold">{row.barcode}</td>
                  <td className="px-3 py-3">{number.format(row.inventoryQuantity)}</td>
                  <td className="px-3 py-3 text-xs">
                    {row.inventoryRequiresReview
                      ? "검토 필요"
                      : row.initialZeroUnverified
                        ? "초기 0·미확인"
                        : row.inventoryVerification}
                  </td>
                  <td className="px-3 py-3">{number.format(row.movementCount)}</td>
                  <td className="px-3 py-3">{number.format(row.receiptCostCount)}</td>
                  <td className="px-3 py-3">{number.format(row.latestCostKrw)}원</td>
                  <td className="px-3 py-3">{number.format(row.protectedCostKrw)}원</td>
                </tr>
              ))}
              {!reviewRows.length ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-emerald-700">
                    재고·원가 신뢰도 보완 대상이 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="mt-4 break-all text-xs text-slate-400">
          원장 지문 {report.contentFingerprint}
        </p>
      </section>
    </>
  );
}

function Metric({
  label,
  value,
  note,
  warning = false,
  danger = false,
}: {
  label: string;
  value: number;
  note?: string;
  warning?: boolean;
  danger?: boolean;
}) {
  const tone = danger
    ? "border-rose-200 bg-rose-50"
    : warning
      ? "border-amber-200 bg-amber-50"
      : "border-slate-200 bg-white";
  return (
    <article className={`rounded-xl border p-4 ${tone}`}>
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block text-xl text-slate-950">
        {number.format(value)}
      </strong>
      {note ? <span className="mt-1 block text-xs text-slate-500">{note}</span> : null}
    </article>
  );
}

function Status({ tone, text }: { tone: "amber" | "rose"; text: string }) {
  return (
    <p
      className={`rounded-xl border p-4 text-sm font-semibold ${
        tone === "rose"
          ? "border-rose-200 bg-rose-50 text-rose-900"
          : "border-amber-200 bg-amber-50 text-amber-900"
      }`}
    >
      {text}
    </p>
  );
}
