import type { ReactNode } from "react";
import { InternalChinaReceiptPanel } from "@/components/china-order-manager/InternalChinaReceiptPanel";
import { loadFastPurchaseInternalDrafts } from "@/lib/fastPurchaseInternalDraft";
import {
  koreanMonthLabel,
  seoulCalendarMonth,
} from "@/lib/monthlyPurchasePolicy";
import { loadMonthlyDraftDisplayMetadata } from "@/lib/monthlyPurchaseDraftDisplayMetadata";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

export default async function ChinaOrderManagerLayout({
  children,
}: {
  children: ReactNode;
}) {
  const currentCycleMonth = seoulCalendarMonth(new Date());
  const internalDraftState = await loadFastPurchaseInternalDrafts();
  const currentDrafts = internalDraftState.drafts.filter(
    (draft) => draft.cycleMonth === currentCycleMonth && draft.openQuantity > 0,
  );
  const barcodes = currentDrafts.flatMap((draft) =>
    draft.lines.filter((line) => line.openQuantity > 0).map((line) => line.barcode),
  );
  const metadata = barcodes.length
    ? await loadMonthlyDraftDisplayMetadata(barcodes)
    : { byBarcode: {}, warnings: [] as string[] };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 to-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-black tracking-[0.12em] text-blue-700">
              MONTHLY PURCHASE · RECEIPT CYCLE
            </span>
            <h1 className="mt-1 text-xl font-black text-slate-950">
              {koreanMonthLabel(currentCycleMonth)} 발주·입고 사이클
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Commerce OS 발주정책은 달력월 기준 월 1회입니다. 같은 월에는 발주 Draft를 하나의 사이클로 묶고, 실제 입고수량을 이 사이클에 누적해 다음 달 발주안의 미입고 차감 기준으로 사용합니다.
            </p>
          </div>
          <div className="rounded-xl border border-blue-200 bg-white px-4 py-3 text-right">
            <span className="block text-xs font-bold text-slate-500">운영 주기</span>
            <strong className="mt-1 block text-lg text-blue-700">월 1회</strong>
            <span className="mt-1 block text-xs text-slate-500">
              현재 활성 Draft {currentDrafts.length.toLocaleString("ko-KR")}건
            </span>
          </div>
        </div>
      </section>

      {currentDrafts.map((draft) => (
        <InternalChinaReceiptPanel
          key={draft.draftId}
          draftId={draft.draftId}
          cycleMonth={draft.cycleMonth}
          lines={draft.lines
            .filter((line) => line.openQuantity > 0)
            .map((line) => {
              const display = metadata.byBarcode[line.barcode];
              return {
                barcode: line.barcode,
                modelNo: display?.modelNo ?? "",
                modelName: display?.modelName ?? "",
                saleOption: display?.saleOption ?? "",
                orderedQuantity: line.orderedQuantity,
                receivedQuantity: line.receivedQuantity,
                openQuantity: line.openQuantity,
                status: line.status,
              };
            })}
        />
      ))}

      {metadata.warnings.length ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
          입고 화면 상품표시 일부를 불러오는 중 경고가 있었습니다: {metadata.warnings.slice(0, 3).join(" · ")}
        </section>
      ) : null}

      {children}
    </div>
  );
}
