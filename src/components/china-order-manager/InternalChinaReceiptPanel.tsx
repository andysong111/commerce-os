"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type InternalChinaReceiptPanelLine = {
  barcode: string;
  modelNo: string;
  modelName: string;
  saleOption: string;
  orderedQuantity: number;
  receivedQuantity: number;
  openQuantity: number;
  status: string;
};

const number = new Intl.NumberFormat("ko-KR");

function monthLabel(month: string) {
  const matched = month.match(/^(\d{4})-(\d{2})$/);
  return matched ? `${Number(matched[1])}년 ${Number(matched[2])}월` : month;
}

function clamp(value: unknown, maximum: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(maximum, Math.max(0, parsed));
}

export function InternalChinaReceiptPanel({
  draftId,
  cycleMonth,
  lines,
}: {
  draftId: string;
  cycleMonth: string;
  lines: InternalChinaReceiptPanelLine[];
}) {
  const router = useRouter();
  const openLines = useMemo(
    () => lines.filter((line) => line.openQuantity > 0),
    [lines],
  );
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(openLines.map((line) => [line.barcode, line.openQuantity])),
  );

  const selected = openLines
    .map((line) => ({
      barcode: line.barcode,
      quantity: clamp(quantities[line.barcode], line.openQuantity),
    }))
    .filter((line) => line.quantity > 0);
  const selectedQuantity = selected.reduce((sum, line) => sum + line.quantity, 0);
  const remainingTotal = openLines.reduce((sum, line) => sum + line.openQuantity, 0);

  function fillAll() {
    setQuantities(
      Object.fromEntries(openLines.map((line) => [line.barcode, line.openQuantity])),
    );
    setNotice("모든 품목의 남은 미입고수량을 이번 입고수량으로 채웠습니다.");
  }

  function clearAll() {
    setQuantities(Object.fromEntries(openLines.map((line) => [line.barcode, 0])));
    setNotice("이번 입고수량을 모두 0으로 초기화했습니다.");
  }

  async function confirmReceipt() {
    if (!selected.length || selectedQuantity <= 0) {
      setNotice("이번에 실제 입고된 품목의 수량을 1개 이상 입력하세요.");
      return;
    }
    const fullReceipt = selectedQuantity === remainingTotal;
    const prompt = fullReceipt
      ? `${monthLabel(cycleMonth)} 발주 건의 남은 ${number.format(remainingTotal)}개를 전량 입고확정할까요?`
      : `${monthLabel(cycleMonth)} 발주 건에서 ${number.format(selected.length)} SKU · ${number.format(selectedQuantity)}개를 부분입고로 확정할까요?`;
    if (!window.confirm(`${prompt}\n\n확정 즉시 중국 발주·입고 원장의 미입고 수량이 차감됩니다.`)) return;

    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/china-order-manager/receipts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          draftId,
          cycleMonth,
          lines: selected,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || body.ok !== true) {
        throw new Error(body.message || `입고확정 실패 (${response.status})`);
      }
      setNotice(body.message || "입고확정을 완료했습니다.");
      setExpanded(false);
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "입고확정을 완료하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (!openLines.length) return null;

  return (
    <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-800">
              {monthLabel(cycleMonth)} 사이클
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
              월 1회 발주·입고
            </span>
          </div>
          <h2 className="mt-3 text-lg font-black text-slate-950">입고 처리</h2>
          <p className="mt-1 text-sm text-slate-600">
            {openLines.length.toLocaleString("ko-KR")} SKU · 남은 미입고 {number.format(remainingTotal)}개. 전량 도착했다면 기본값 그대로 확정하고, 일부만 왔다면 실제 도착수량만 수정하세요.
          </p>
          <p className="mt-1 font-mono text-[11px] text-slate-400">{draftId}</p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800"
        >
          {expanded ? "입고 입력 닫기" : "입고 처리 열기"}
        </button>
      </div>

      {expanded ? (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={fillAll}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
            >
              남은 수량 전부 채우기
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
            >
              전체 0으로 초기화
            </button>
            <span className="self-center text-xs font-bold text-emerald-800">
              이번 입고 예정 · {number.format(selected.length)} SKU · {number.format(selectedQuantity)}개
            </span>
          </div>

          <div className="max-h-[560px] overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-[980px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-bold text-slate-500">
                <tr>
                  <th className="px-3 py-3">B-code / 상품</th>
                  <th className="px-3 py-3">옵션</th>
                  <th className="px-3 py-3 text-right">실주문</th>
                  <th className="px-3 py-3 text-right">누적 입고</th>
                  <th className="px-3 py-3 text-right">남은 미입고</th>
                  <th className="px-3 py-3 text-right">이번 입고수량</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {openLines.map((line) => (
                  <tr key={line.barcode}>
                    <td className="px-3 py-3">
                      <strong className="font-mono text-slate-950">{line.barcode}</strong>
                      <span className="mt-1 block text-xs text-slate-600">
                        {[line.modelNo, line.modelName].filter(Boolean).join(" · ") || "상품정보 확인 중"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{line.saleOption || "-"}</td>
                    <td className="px-3 py-3 text-right font-semibold">{number.format(line.orderedQuantity)}</td>
                    <td className="px-3 py-3 text-right font-semibold">{number.format(line.receivedQuantity)}</td>
                    <td className="px-3 py-3 text-right font-black text-blue-700">{number.format(line.openQuantity)}</td>
                    <td className="px-3 py-3 text-right">
                      <input
                        type="number"
                        min={0}
                        max={line.openQuantity}
                        step={1}
                        value={quantities[line.barcode] ?? 0}
                        onChange={(event) =>
                          setQuantities((current) => ({
                            ...current,
                            [line.barcode]: clamp(event.target.value, line.openQuantity),
                          }))
                        }
                        className="w-28 rounded-lg border border-slate-300 px-2.5 py-2 text-right font-black outline-none focus:border-emerald-500"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs leading-5 text-emerald-950">
              일부만 입력하면 PARTIALLY_RECEIVED, 남은 수량까지 모두 입고되면 RECEIVED로 자동 전환합니다. 확정 입고수량과 내부기준원가는 Product Master 입고원가에도 연결합니다.
            </p>
            <button
              type="button"
              disabled={saving || selectedQuantity <= 0}
              onClick={confirmReceipt}
              className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "입고확정 중…" : `입고확정 · ${number.format(selectedQuantity)}개`}
            </button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
