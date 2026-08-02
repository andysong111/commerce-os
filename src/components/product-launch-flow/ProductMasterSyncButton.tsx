"use client";

import { useState } from "react";

export function ProductMasterSyncButton() {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function sync() {
    if (running) return;
    setRunning(true);
    setFailed(false);
    setMessage("상품마스터로 기준정보를 전송하고 있습니다.");
    try {
      const response = await fetch(
        "/api/product-launch-tracker/product-master-sync",
        {
          method: "POST",
          headers: { accept: "application/json" },
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      const text = await response.text();
      let payload: { message?: string; code?: string } = {};
      if (text) {
        try {
          payload = JSON.parse(text) as { message?: string; code?: string };
        } catch {
          payload.message = text.slice(0, 300);
        }
      }
      if (!response.ok) {
        throw new Error(
          payload.message ||
            payload.code ||
            `상품마스터 동기화 요청에 실패했습니다. HTTP ${response.status}`,
        );
      }
      setMessage(payload.message || "상품마스터 동기화를 완료했습니다.");
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "상품마스터 동기화 중 알 수 없는 오류가 발생했습니다.",
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {message && (
        <span
          className={`max-w-xl text-right text-xs leading-5 ${
            failed ? "text-red-700" : "text-slate-600"
          }`}
        >
          {message}
        </span>
      )}
      <a
        href="https://commerce-os-product-master.vercel.app/"
        target="_blank"
        rel="noreferrer"
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
      >
        상품마스터 열기
      </a>
      <button
        type="button"
        onClick={sync}
        disabled={running}
        className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {running ? "동기화 중…" : "상품마스터 동기화"}
      </button>
    </div>
  );
}
