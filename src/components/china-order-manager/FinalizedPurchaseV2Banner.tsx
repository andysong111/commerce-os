import Link from "next/link";
import { seoulCalendarMonth } from "@/lib/monthlyPurchasePolicy";
import { loadFinalizedPurchaseV2Recommendation } from "@/lib/purchaseV2Finalization";

const money = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

export async function FinalizedPurchaseV2Banner() {
  const cycleMonth = seoulCalendarMonth(new Date());
  const snapshot = await loadFinalizedPurchaseV2Recommendation(cycleMonth);

  if (!snapshot) {
    return (
      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-blue-700">
              PURCHASE V2 · NOT FINALIZED
            </span>
            <p className="mt-1 text-sm font-bold text-blue-950">
              이번 주문일의 실제 현금을 입력해 V2 권장안을 계산한 뒤 예산확정하면 이 화면에 고정됩니다.
            </p>
          </div>
          <Link
            href="/china-order-manager/purchase-v2"
            className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-black text-white hover:bg-blue-800"
          >
            발주권장안 V2 열기
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-emerald-700">
            PURCHASE V2 · FINALIZED
          </span>
          <h2 className="mt-1 text-lg font-black text-emerald-950">
            {snapshot.cycleMonth} 발주권장안 · 예산확정 완료
          </h2>
          <p className="mt-1 text-xs leading-5 text-emerald-800">
            {new Date(snapshot.finalizedAt).toLocaleString("ko-KR")} · 권장 {snapshot.recommendedSkuCount} SKU · 적용현금 {money.format(snapshot.effectiveCashKrw)}원 · 예상 총비용 {money.format(snapshot.expectedAllInSpendKrw)}원
          </p>
        </div>
        <Link
          href="/china-order-manager/purchase-v2"
          className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white hover:bg-emerald-800"
        >
          확정 발주안 조회
        </Link>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-emerald-950">
        {snapshot.rows.slice(0, 12).map((row) => (
          <span key={row.barcode} className="rounded-full border border-emerald-300 bg-white px-3 py-1.5">
            {row.barcode} · {money.format(row.allocatedQuantity)}개
          </span>
        ))}
        {snapshot.rows.length > 12 ? (
          <span className="rounded-full border border-emerald-300 bg-white px-3 py-1.5">
            외 {snapshot.rows.length - 12}개
          </span>
        ) : null}
      </div>
    </section>
  );
}
