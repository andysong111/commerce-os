import Link from "next/link";
import { seoulCalendarMonth } from "@/lib/monthlyPurchasePolicy";
import { loadFinalizedPurchaseRecommendationV2 } from "@/lib/purchaseRecommendationFinalization";

const money = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

export async function PurchaseV2FinalizedBanner() {
  const cycleMonth = seoulCalendarMonth(new Date());
  const finalized = await loadFinalizedPurchaseRecommendationV2(cycleMonth).catch(
    () => null,
  );

  return (
    <section
      className={`rounded-2xl border px-4 py-3 shadow-sm ${
        finalized
          ? "border-emerald-300 bg-emerald-50"
          : "border-amber-300 bg-amber-50"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span
            className={`text-[11px] font-black tracking-[0.12em] ${
              finalized ? "text-emerald-700" : "text-amber-700"
            }`}
          >
            1688 주문 · 발주마감 기준
          </span>
          {finalized ? (
            <p className="mt-1 text-sm font-bold leading-6 text-emerald-950">
              {cycleMonth} 발주 V2 확정 · 현금 {money.format(finalized.cashKrw)}원 ·
              권장 {money.format(finalized.report.recommendedSkuCount)} SKU · 예상
              총비용 {money.format(finalized.report.expectedAllInSpendKrw)}원
            </p>
          ) : (
            <p className="mt-1 text-sm font-bold leading-6 text-amber-950">
              이번 주문일 발주 V2 예산과 권장안이 아직 확정되지 않았습니다. 확정 전에는
              1688 주문 기준안으로 사용하지 않습니다.
            </p>
          )}
        </div>
        <Link
          href="/china-order-manager/purchase-v2"
          className={`rounded-xl px-4 py-2 text-xs font-black text-white ${
            finalized ? "bg-emerald-700" : "bg-amber-700"
          }`}
        >
          {finalized ? "확정 발주안 조회" : "발주 V2 계산·확정"}
        </Link>
      </div>
      {finalized ? (
        <p className="mt-1 break-all text-[10px] text-emerald-700">
          확정 {new Date(finalized.finalizedAt).toLocaleString("ko-KR")} · {finalized.reportFingerprint}
        </p>
      ) : null}
    </section>
  );
}
