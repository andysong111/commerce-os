import type { ReactNode } from "react";
import { InternalChinaReceiptPanel } from "@/components/china-order-manager/InternalChinaReceiptPanel";
import { loadFastPurchaseInternalDrafts } from "@/lib/fastPurchaseInternalDraft";
import { loadInternalChinaForwarderCostSummary } from "@/lib/internalChinaForwarderCost";
import {
  koreanMonthLabel,
  seoulCalendarMonth,
} from "@/lib/monthlyPurchasePolicy";
import { loadMonthlyDraftDisplayMetadata } from "@/lib/monthlyPurchaseDraftDisplayMetadata";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

const TRANSIENT_LEDGER_RETRY_DELAYS_MS = [250, 750, 1_500] as const;

function transientLedgerError(message: string | null | undefined) {
  const normalized = String(message ?? "").toLowerCase();
  return [
    "schema cache",
    "pgrst002",
    "connection timeout",
    "connection terminated",
    "timed out",
    "timeout",
    "fetch failed",
    "temporarily unavailable",
    "retrying",
  ].some((token) => normalized.includes(token));
}

async function loadInternalDraftsForReceiptClose() {
  let state = await loadFastPurchaseInternalDrafts();
  for (const delayMs of TRANSIENT_LEDGER_RETRY_DELAYS_MS) {
    if (!state.error || !transientLedgerError(state.error)) return state;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    state = await loadFastPurchaseInternalDrafts();
  }
  return state;
}

export default async function ChinaOrderManagerLayout({
  children,
}: {
  children: ReactNode;
}) {
  const currentCycleMonth = seoulCalendarMonth(new Date());
  const internalDraftState = await loadInternalDraftsForReceiptClose();
  const currentCycleDrafts = internalDraftState.drafts.filter(
    (draft) =>
      draft.cycleMonth === currentCycleMonth && draft.orderedQuantity > 0,
  );
  const currentActiveDrafts = currentCycleDrafts.filter(
    (draft) => draft.openQuantity > 0,
  );
  const barcodes = currentCycleDrafts.flatMap((draft) =>
    draft.lines.map((line) => line.barcode),
  );
  const metadata = barcodes.length
    ? await loadMonthlyDraftDisplayMetadata(barcodes)
    : { byBarcode: {}, warnings: [] as string[] };

  const forwarderCostRows = await Promise.all(
    currentCycleDrafts.map(async (draft) => {
      try {
        return {
          draftId: draft.draftId,
          summary: await loadInternalChinaForwarderCostSummary(
            draft.draftId,
            draft.cycleMonth,
          ),
          warning: "",
        };
      } catch (error) {
        return {
          draftId: draft.draftId,
          summary: null,
          warning:
            error instanceof Error
              ? `${draft.draftId} 배송대행 비용 화면: ${error.message}`
              : `${draft.draftId} 배송대행 비용 화면을 불러오지 못했습니다.`,
        };
      }
    }),
  );
  const forwarderCostByDraft = new Map(
    forwarderCostRows
      .filter((row) => row.summary)
      .map((row) => [row.draftId, row.summary!] as const),
  );
  const forwarderWarnings = forwarderCostRows
    .map((row) => row.warning)
    .filter(Boolean);
  const pendingForwarderCostCount = forwarderCostRows.filter(
    (row) => row.summary && !row.summary.actualCostKrw,
  ).length;

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
              Commerce OS 발주정책은 달력월 기준 월 1회입니다. 같은 월에는 발주 Draft를 하나의 사이클로 묶고, 실제 입고수량을 누적한 뒤 배송대행지 실제 청구액을 별도 월 발주비용으로 마감합니다.
            </p>
          </div>
          <div className="rounded-xl border border-blue-200 bg-white px-4 py-3 text-right">
            <span className="block text-xs font-bold text-slate-500">운영 주기</span>
            <strong className="mt-1 block text-lg text-blue-700">월 1회</strong>
            <span className="mt-1 block text-xs text-slate-500">
              활성 Draft {currentActiveDrafts.length.toLocaleString("ko-KR")}건 · 배송비 미마감 {pendingForwarderCostCount.toLocaleString("ko-KR")}건
            </span>
          </div>
        </div>
      </section>

      {currentCycleDrafts.map((draft) => {
        const forwarderCost = forwarderCostByDraft.get(draft.draftId);
        if (!forwarderCost) return null;
        return (
          <InternalChinaReceiptPanel
            key={draft.draftId}
            draftId={draft.draftId}
            cycleMonth={draft.cycleMonth}
            forwarderCost={forwarderCost}
            lines={draft.lines.map((line) => {
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
        );
      })}

      {metadata.warnings.length || forwarderWarnings.length ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
          {[...metadata.warnings, ...forwarderWarnings]
            .slice(0, 4)
            .join(" · ")}
        </section>
      ) : null}

      {children}
    </div>
  );
}
