"use client";

import { useCallback, useEffect, useState } from "react";

function nativeSaveButton() {
  if (typeof document === "undefined") return null;
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
  return (
    buttons.find((button) => {
      const label = (button.textContent ?? "").replace(/\s+/g, " ").trim();
      return label === "발주초안 저장" || label === "양방향 저장 중...";
    }) ?? null
  );
}

export function InternalChinaDraftStickySave({
  status,
}: {
  status: "DRAFT" | "ORDERED";
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const triggerSave = useCallback(() => {
    if (status !== "DRAFT") {
      setMessage("이미 실주문 기록이 시작된 Draft라 수정 저장이 잠겨 있습니다.");
      return;
    }

    const target = nativeSaveButton();
    if (!target) {
      setMessage("기존 발주초안 저장 버튼을 찾지 못했습니다. 페이지를 새로고침한 뒤 다시 시도하세요.");
      return;
    }

    const label = (target.textContent ?? "").replace(/\s+/g, " ").trim();
    if (target.disabled || label === "양방향 저장 중...") {
      setBusy(true);
      setMessage("이미 저장 중입니다.");
      return;
    }

    setBusy(true);
    setMessage("입력값 저장을 요청했습니다.");
    target.click();

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const current = nativeSaveButton();
      const currentLabel = (current?.textContent ?? "").replace(/\s+/g, " ").trim();
      const nativeBusy = currentLabel === "양방향 저장 중...";
      if (!nativeBusy || Date.now() - startedAt > 15_000) {
        window.clearInterval(timer);
        setBusy(false);
        if (!nativeBusy) {
          setMessage("저장 처리가 끝났습니다. 입력값은 Draft에 저장되고 구매정보는 상품출시진행관리·상품마스터로 양방향 반영됩니다.");
        }
      }
    }, 250);
  }, [status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      triggerSave();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [triggerSave]);

  return (
    <aside className="fixed bottom-24 right-5 z-[80] flex max-w-[360px] flex-col items-end gap-2">
      {message ? (
        <div className="rounded-xl border border-blue-200 bg-white/95 px-3 py-2 text-xs font-bold leading-5 text-blue-950 shadow-lg backdrop-blur">
          {message}
        </div>
      ) : null}
      <button
        type="button"
        onClick={triggerSave}
        disabled={busy || status !== "DRAFT"}
        className="rounded-full border border-blue-300 bg-blue-700 px-5 py-3 text-sm font-black text-white shadow-xl hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status !== "DRAFT" ? "저장 잠김" : busy ? "저장 중..." : "입력값 저장"}
      </button>
      <span className="rounded-full bg-slate-950/80 px-2.5 py-1 text-[10px] font-bold text-white shadow">
        Ctrl+S로도 저장
      </span>
    </aside>
  );
}
