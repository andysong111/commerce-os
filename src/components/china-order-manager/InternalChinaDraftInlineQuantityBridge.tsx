"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

export type InlineQuantityLine = {
  barcode: string;
  quantity: number;
};

type QuantityResponse = {
  ok?: boolean;
  message?: string;
  draft?: {
    lines?: Array<{ barcode?: string; quantity?: number }>;
  };
};

type TargetCell = {
  barcode: string;
  cell: HTMLTableCellElement;
};

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function nativeSaveButton() {
  if (typeof document === "undefined") return null;
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
  return (
    buttons.find((button) => {
      const label = normalizeText(button.textContent);
      return label === "발주초안 저장" || label === "양방향 저장 중...";
    }) ?? null
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function saveCurrentDraftInputs() {
  const target = nativeSaveButton();
  if (!target) return;

  const startedLabel = normalizeText(target.textContent);
  if (!target.disabled && startedLabel !== "양방향 저장 중...") {
    target.click();
    await sleep(60);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    const current = nativeSaveButton();
    const label = normalizeText(current?.textContent);
    if (current && !current.disabled && label !== "양방향 저장 중...") return;
    await sleep(120);
  }
  throw new Error("입력값 자동 저장이 오래 걸리고 있습니다. 우측 `입력값 저장`을 한 번 누른 뒤 다시 시도하세요.");
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
  const [value, setValue] = useState(String(quantity));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setValue(String(quantity));
  }, [quantity]);

  const targetQuantity = Math.round(Number(value));
  const changed = Number.isFinite(targetQuantity) && targetQuantity !== quantity;

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
    setMessage("입력값 저장 중");
    try {
      // Quantity changes refresh the server-backed Draft. Save any link/option/price
      // edits that are still only in the React table state first, so one click is safe.
      await saveCurrentDraftInputs();
      setMessage("수량 반영 중");
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
      const savedQuantity =
        body.draft?.lines?.find((line) => line.barcode === barcode)?.quantity ?? targetQuantity;
      setValue(String(savedQuantity));
      setMessage("저장됨");
      onSaved(barcode, savedQuantity, body.message || `${barcode} 수량을 변경했습니다.`);
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
  const router = useRouter();
  const [targets, setTargets] = useState<TargetCell[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map((line) => [line.barcode, line.quantity])),
  );
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setQuantities((current) => {
      const next = { ...current };
      for (const line of lines) next[line.barcode] = line.quantity;
      return next;
    });
  }, [lines]);

  const scan = useCallback(() => {
    const next = findQuantityTargets();
    setTargets((current) => (sameTargets(current, next) ? current : next));
  }, []);

  useEffect(() => {
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", scan);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scan);
    };
  }, [scan]);

  const lineByBarcode = useMemo(
    () => new Map(lines.map((line) => [line.barcode, line] as const)),
    [lines],
  );

  function saved(barcode: string, quantity: number, message: string) {
    setQuantities((current) => ({ ...current, [barcode]: quantity }));
    setNotice(message);
    // Re-render server totals/budget without a full location reload; Next.js refresh
    // preserves the operator's current scroll position.
    router.refresh();
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
            quantity={quantities[target.barcode] ?? line.quantity}
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
