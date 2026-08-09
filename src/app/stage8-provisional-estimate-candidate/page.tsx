import { PageHeader } from "@/components/PageHeader";
import { loadProvisionalEstimateCandidate } from "@/lib/stage8ProvisionalEstimateCandidate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const number = new Intl.NumberFormat("ko-KR");

export default async function ProvisionalEstimateCandidatePage() {
  const report = await loadProvisionalEstimateCandidate();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="COMMERCE OS · STAGE 8 · PROVISIONAL ESTIMATE CANDIDATE"
        title="과거발주 기반 PROVISIONAL 추정재고 후보"
        description="완전증거 과거발주에 14일 리드타임 가정을 두고 그 이후 exact Canonical 판매를 차감해 잔여후보를 계산합니다. 실제 입고 여부와 발주 전 기존재고가 증명되지 않았으므로 이 숫자를 현재재고·상한·하한으로 쓰지 않습니다."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="상태" value={report.state} />
        <Metric label="발주이력 준비" value={number.format(report.orderHistoryReadyCount)} />
        <Metric label="잔여후보 준비" value={number.format(report.candidateReadyCount)} />
        <Metric label="판매범위 부족" value={number.format(report.coverageGapCount)} />
        <Metric label="발주입력 부족" value={number.format(report.purchaseInputMissingCount)} />
        <Metric label="리드타임" value={`${number.format(report.operatingLeadDays)}일`} />
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Metric label="수령가정 양쪽 발주" value={number.format(report.orderDirectionStableCount)} />
        <Metric label="수령가정 양쪽 보류" value={number.format(report.holdDirectionStableCount)} />
        <Metric label="수령가정 민감" value={number.format(report.receiptAssumptionSensitiveCount)} />
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${report.state === "READY_READ_ONLY" ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-slate-500">CANDIDATE ≠ CURRENT INVENTORY · READ ONLY</span>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{report.state}</h2>
          </div>
          <strong className="rounded-full bg-slate-950 px-4 py-2 text-sm text-white">INVENTORY / PURCHASE WRITE 0</strong>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{report.message}</p>
        <p className="mt-2 text-xs text-slate-500">Canonical coverage · {report.canonicalCoverageStartAt ?? "-"} → {report.canonicalCoverageEndAt ?? "-"}</p>
        <p className="mt-1 break-all text-xs text-slate-500">Fingerprint · {report.fingerprint}</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[1700px] text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="px-3 py-2">B-code</th>
                <th className="px-3 py-2">상품</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">원본 aaa</th>
                <th className="px-3 py-2">최근발주일</th>
                <th className="px-3 py-2">가정입고일</th>
                <th className="px-3 py-2">최근발주량</th>
                <th className="px-3 py-2">이후 판매</th>
                <th className="px-3 py-2">잔여후보</th>
                <th className="px-3 py-2">미수령가정 발주</th>
                <th className="px-3 py-2">전량수령가정 발주</th>
                <th className="px-3 py-2">민감도</th>
                <th className="px-3 py-2">메시지</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.barcode} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 font-mono font-black text-slate-950">{row.barcode}</td>
                  <td className="px-3 py-2 font-bold">{row.productName}</td>
                  <td className="px-3 py-2 font-black">{row.state}</td>
                  <td className="px-3 py-2 font-mono">{row.originalModelNos.join(" / ") || "-"}</td>
                  <td className="px-3 py-2">{row.latestOrderDate ?? "-"}</td>
                  <td className="px-3 py-2">{row.assumedReceiptDate ?? "-"}</td>
                  <td className="px-3 py-2">{row.latestOrderQuantity === null ? "-" : number.format(row.latestOrderQuantity)}</td>
                  <td className="px-3 py-2">{row.canonicalSalesSinceAssumedReceipt === null ? "-" : number.format(row.canonicalSalesSinceAssumedReceipt)}</td>
                  <td className="px-3 py-2 font-black">{row.latestOrderResidualCandidate === null ? "-" : number.format(row.latestOrderResidualCandidate)}</td>
                  <td className="px-3 py-2">{row.noReceiptRecommendedQuantity === null ? "-" : `${row.noReceiptPurchaseStatus} · ${number.format(row.noReceiptRecommendedQuantity)}`}</td>
                  <td className="px-3 py-2">{row.fullReceiptRecommendedQuantity === null ? "-" : `${row.fullReceiptPurchaseStatus} · ${number.format(row.fullReceiptRecommendedQuantity)}`}</td>
                  <td className="px-3 py-2 font-black">{row.receiptAssumptionSensitivity}</td>
                  <td className="px-3 py-2 text-slate-500">{row.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
        <strong>이 잔여후보는 현재재고가 아닙니다.</strong><br />
        최근 발주가 실제로 전량 입고되었는지 확인되지 않았고, 그 발주 직전부터 남아 있던 재고도 알 수 없습니다. 따라서 `latestOrderResidualCandidate`는 추정식 후보를 평가하기 위한 숫자일 뿐 실제재고·재고상한·재고하한이 아닙니다. Product Master 재고승격, 실제 중국발주 Draft, 가격변경은 모두 OFF입니다.
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
