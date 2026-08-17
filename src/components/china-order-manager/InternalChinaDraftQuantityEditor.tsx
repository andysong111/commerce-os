"use client";

import { useMemo, useState } from "react";

export type InternalChinaDraftQuantityLine = {
  barcode: string;
  modelNo: string;
  modelName: string;
  saleOption: string;
  quantity: number;
};

type QuantityResponse = {
  ok?: boolean;
  message?: string;
};

export function InternalChinaDraftQuantityEditor({
  draftId,
  status,
  lines,
}: {
  draftId: string;
  status: "DRAFT" | "ORDERED";
  lines: InternalChinaDraftQuantityLine[];
}) {
  const [barcode, setBarcode] = useState(lines[0]?.barcode ?? "");
  const selected = useMemo(
    () => lines.find((line) => line.barcode === barcode) ?? lines[0] ?? null,
    [barcode, lines],
  );
  const [targetQuantity, setTargetQuantity] = useState(selected?.quantity ?? 1);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  function selectBarcode(nextBarcode: string) {
    setBarcode(nextBarcode);
    const next = lines.find((line) => line.barcode === nextBarcode);
    if (next) setTargetQuantity(next.quantity);
    setNotice("");
  }

  async function save() {
    if (!selected || status !== "DRAFT") return;
    const quantity = Math.round(Number(targetQuantity));
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 9_999) {
      setNotice("주문수량은 1개 이상 9,999개 이하로 입력하세요.");
      return;
    }
    if (quantity === selected.quantity) {
      setNotice("현재 수량과 동일합니다.");
      return;
    }
    if (
      !window.confirm(
        `${selected.barcode} · ${selected.modelName || selected.modelNo}\n${selected.quantity.toLocaleString("ko-KR")}개 → ${quantity.toLocaleString("ko-KR")}개로 변경하시겠습니까?\n\n현재 입력 중인 중국옵션·링크·단가는 먼저 우측 '입력값 저장' 또는 Ctrl+S로 저장해 두는 것이 안전합니다.`,
      )
    ) {
      return;
    }

    setSaving(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/china-order-manager/drafts/${encodeURIComponent(draftId)}/quantity`,
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            barcode: selected.barcode,
            targetQuantity: quantity,
          }),
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      const body = (await response.json().catch(() => ({}))) as QuantityResponse;
      if (!response.ok || !body.ok) {
        throw new Error(body.message || "주문수량 변경 저장에 실패했습니다.");
      }
      setNotice(body.message || "주문수량을 변경했습니다. 화면을 갱신합니다.");
      window.setTimeout(() => window.location.reload(), 450);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "주문수량 변경 요청이 일시적으로 실패했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50/70 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-xs font-black tracking-[0.12em] text-blue-700">
            MONTHLY DRAFT · QUANTITY OVERRIDE
          </span>
          <h2 className="mt-1 text-xl font-black text-slate-950">현재 Draft 수량 조정</h2>
          <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-700">
            이미 Draft에 들어온 B-code의 실제 주문수량을 주문 직전에 조정합니다. 변경 수량은 실제 ORDERED·부분입고·최종입고 기준에 반영됩니다. 실제 1688 주문·결제는 실행하지 않습니다.
          </p>
        </div>
        <span className="rounded-full border border-blue-300 bg-white px-3 py-1.5 text-xs font-black text-blue-800">
          1~9,999개 · 주문 전만 수정
        </span>
      </div>

      {status !== "DRAFT" ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600">
          실제 주문완료 기록이 시작된 Draft라 수량 조정을 잠갔습니다.
        </div>
      ) : selected ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_auto] lg:items-end">
          <label className="block">
            <span className="mb-1 block text-xs font-black text-slate-600">B-code / 모델 / 옵션</span>
            <select
              value={selected.barcode}
              onChange={(event) => selectBarcode(event.target.value)}
              className="w-full rounded-xl border border-blue-300 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-500"
            >
              {lines.map((line) => (
                <option key={line.barcode} value={line.barcode}>
                  {line.barcode} · {line.modelName || line.modelNo || "모델명 -"} · {line.saleOption || "단품"} · 현재 {line.quantity.toLocaleString("ko-KR")}개
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-black text-slate-600">변경할 총 주문수량</span>
            <input
              type="number"
              min={1}
              max={9999}
              step={1}
              value={targetQuantity}
              onChange={(event) => setTargetQuantity(Number(event.target.value))}
              className="w-full rounded-xl border border-blue-300 bg-white px-4 py-3 text-right text-sm font-black text-slate-900 outline-none focus:border-blue-500"
            />
          </label>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "수량 저장 중..." : "수량 변경 저장"}
          </button>
        </div>
      ) : null}

      <p className="mt-3 text-xs font-semibold leading-5 text-blue-900">
        중국옵션·1688 링크·위안단가를 이미 입력 중이었다면 수량 조정 전에 우측 `입력값 저장` 또는 Ctrl+S를 먼저 누르세요. 수량 변경 후에는 화면이 새로고침됩니다.
      </p>
      {notice ? (
        <div className="mt-3 rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm font-bold text-blue-950">
          {notice}
        </div>
      ) : null}
    </section>
  );
}
