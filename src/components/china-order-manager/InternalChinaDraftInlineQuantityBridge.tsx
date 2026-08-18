"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

export type InlineQuantityLine = {
  barcode: string;
  quantity: number;
};

type QuantityResponse = {
  ok?: boolean;
  message?: string;
  saved?: {
    targetQuantity?: number;
  };
};

type TargetCell = {
  barcode: string;
  cell: HTMLTableCellElement;
};

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function findQuantityTargets() {
  if (typeof document === "undefined") return [] as TargetCell[];
  const tables = Array.from(document.querySelectorAll<HTMLTableElement>("table"));
  for (const table of tables) {
    const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th")).map(
      (cell) => normalizeText(cell.textContent),
    );
    const barcodeIndex = headers.findIndex((label) => label.includes("B-code / 모델 / 옵션"));
    const quantityIndex = headers.findIndex((label) => label === "수량");
    if (barcodeIndex < 0 || quantityIndex < 0) continue;

    const targets: TargetCell[] = [];
    for (const row of Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"))) {
      const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>(":scope > td"));
      const barcode = normalizeText(cells[barcodeIndex]?.textContent).match(/[A-Z]{3}\d+-\d+/)?.[0] ?? "";
      const cell = cells[quantityIndex];
      if (!barcode || !cell) continue;
      targets.push({ barcode, cell });
    }
    if (targets.length) return targets;
  }
  return [] as TargetCell[];
}

function sameTargets(left: TargetCell[], right: TargetCell[]) {
  if (left.length !== right.length) return false;
  return left.every(
    (target, index) =>
      target.barcode === right[index]?.barcode && target.cell === right[index]?.cell,
  );
}

function InlineQuantityControl({
  draftId,
  status,
  barcode,
  quantity,
  onSaved,
}: {
  draftId: string;
  status: "DRAFT" | "ORDERED";
  barcode: string;
  quantity: number;
  onSaved: (barcode: string, quantity: number, message: string) => void;
}) {
  const [committedQuantity, setCommittedQuantity] = useState(quantity);
  const [value, setValue] = useState(String(quantity));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const targetQuantity = Math.round(Number(value));
  const changed =
    Number.isFinite(targetQuantity) && targetQuantity !== committedQuantity;

  async function save() {
    if (status !== "DRAFT" || saving) return;
    if (!Number.isFinite(targetQuantity) || targetQuantity < 1 || targetQuantity > 9_999) {
      setMessage("1~9,999");
      return;
    }
    if (!changed) {
      setMessage("동일");
      return;
    }

    setSaving(true);
    setMessage("저장 중");
    try {
      const response = await fetch(
        `/api/china-order-manager/drafts/${encodeURIComponent(draftId)}/quantity`,
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ barcode, targetQuantity }),
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      const body = (await response.json().catch(() => ({}))) as QuantityResponse;
      if (!response.ok || !body.ok) {
        throw new Error(body.message || "수량 변경 저장에 실패했습니다.");
      }
      const savedQuantity = Math.round(
        Number(body.saved?.targetQuantity ?? targetQuantity),
      );
      setCommittedQuantity(savedQuantity);
      setValue(String(savedQuantity));
      setMessage("저장됨");
      onSaved(
        barcode,
        savedQuantity,
        body.message || `${barcode} 수량을 ${savedQuantity.toLocaleString("ko-KR")}개로 저장했습니다.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      data-inline-draft-quantity={barcode}
      className="mt-1 flex min-w-[132px] items-center justify-end gap-1"
    >
      <input
        type="number"
        min={1}
        max={9999}
        step={1}
        value={value}
        disabled={status !== "DRAFT" || saving}
        onChange={(event) => {
          setValue(event.target.value);
          setMessage("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void save();
          }
        }}
        aria-label={`${barcode} 주문수량`}
        className={`w-20 rounded-lg border bg-white px-2 py-1.5 text-right text-xs font-black outline-none disabled:bg-slate-100 ${
          changed ? "border-blue-400 text-blue-900" : "border-slate-300 text-slate-800"
        }`}
      />
      <button
        type="button"
        onClick={() => void save()}
        disabled={status !== "DRAFT" || saving || !changed}
        className="rounded-lg bg-blue-700 px-2.5 py-1.5 text-[11px] font-black text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {saving ? "저장" : "변경"}
      </button>
      {message ? (
        <span
          title={message}
          className={`max-w-[72px] truncate text-[10px] font-bold ${
            message === "저장됨" ? "text-emerald-700" : "text-slate-500"
          }`}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}

export function InternalChinaDraftInlineQuantityBridge({
  draftId,
  status,
  lines,
}: {
  draftId: string;
  status: "DRAFT" | "ORDERED";
  lines: InlineQuantityLine[];
}) {
  const [targets, setTargets] = useState<TargetCell[]>([]);
  const [notice, setNotice] = useState("");

  const scan = useCallback(() => {
    const next = findQuantityTargets();
    setTargets((current) => (sameTargets(current, next) ? current : next));
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(scan);
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", scan);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", scan);
    };
  }, [scan]);

  const lineByBarcode = useMemo(
    () => new Map(lines.map((line) => [line.barcode, line] as const)),
    [lines],
  );

  function saved(barcode: string, quantity: number, message: string) {
    setNotice(message);
    window.dispatchEvent(
      new CustomEvent("internal-china-quantity-saved", {
        detail: { barcode, quantity, message },
      }),
    );
  }

  return (
    <>
      {targets.map((target) => {
        const line = lineByBarcode.get(target.barcode);
        if (!line) return null;
        return createPortal(
          <InlineQuantityControl
            key={target.barcode}
            draftId={draftId}
            status={status}
            barcode={target.barcode}
            quantity={line.quantity}
            onSaved={saved}
          />,
          target.cell,
          `inline-qty-${target.barcode}`,
        );
      })}
      {notice ? (
        <aside className="fixed bottom-40 right-5 z-[79] max-w-[380px] rounded-xl border border-emerald-200 bg-white/95 px-3 py-2 text-xs font-bold leading-5 text-emerald-900 shadow-lg backdrop-blur">
          {notice}
        </aside>
      ) : null}
    </>
  );
}
