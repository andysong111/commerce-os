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
export const maxDuration = 30;

const RECEIPT_LEDGER_TIMEBOX_MS = 4_500;
const DISPLAY_METADATA_TIMEBOX_MS = 2_500;
const FORWARDER_SUMMARY_TIMEBOX_MS = 4_500;

async function timebox<T>(
  task: Promise<T>,
  timeoutMs: number,
  timeoutValue: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(timeoutValue), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function timeboxNullable<T>(task: Promise<T>, timeoutMs: number) {
  return timebox<T | null>(task, timeoutMs, null);
}

async function loadInternalDraftsForReceiptClose() {
  const timeoutState: Awaited<ReturnType<typeof loadFastPurchaseInternalDrafts>> = {
    drafts: [],
    error:
      "Supabase 발주원장 응답이 지연되어 4.5초 안에 화면용 조회를 끝냈습니다. 실제 원장 데이터는 변경되지 않았습니다. 잠시 뒤 새로고침하세요.",
  };
  return timebox(
    loadFastPurchaseInternalDrafts(),
    RECEIPT_LEDGER_TIMEBOX_MS,
    timeoutState,
  );
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
    ? await timebox(
        loadMonthlyDraftDisplayMetadata(barcodes),
        DISPLAY_METADATA_TIMEBOX_MS,
        {
          byBarcode: {},
          warnings: [
            "상품 표시정보 조회가 지연되어 B-code 중심으로 먼저 화면을 열었습니다.",
          ],
        },
      )
    : { byBarcode: {}, warnings: [] as string[] };

  const forwarderCostRows = await Promise.all(
    currentCycleDrafts.map(async (draft) => {
      try {
        const result = await timeboxNullable(
          loadInternalChinaForwarderCostSummary(
            draft.draftId,
            draft.cycleMonth,
          ),
          FORWARDER_SUMMARY_TIMEBOX_MS,
        );
        if (!result) {
          return {
            draftId: draft.draftId,
            summary: null,
            warning: `${draft.draftId} 배송대행 비용 요약 조회가 4.5초를 넘어 화면에서만 일시 보류됐습니다. 원장 데이터는 변경되지 않았습니다.`,
          };
        }
        return {
          draftId: draft.draftId,
          summary: result,
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

      {internalDraftState.error ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
          발주원장 실시간 조회 지연 · {internalDraftState.error}
        </section>
      ) : null}

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