"use client";

import { useState } from "react";

export function ShoplingPriceModifyBulkErrorPanel({ summary, diagnostic }: { summary: string; diagnostic: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(diagnostic);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = diagnostic;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
    <p className="font-semibold">{summary}</p>
    {diagnostic && <details className="mt-3" open>
      <summary className="cursor-pointer font-bold">복사 가능한 오류 상세</summary>
      <textarea
        aria-label="복사 가능한 오류 상세"
        readOnly
        value={diagnostic}
        className="mt-3 min-h-52 w-full rounded-lg border border-red-200 bg-white p-3 font-mono text-xs text-slate-900"
      />
      <button
        type="button"
        onClick={() => void copy()}
        className="mt-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white"
      >
        {copied ? "복사됨" : "오류 내용 복사"}
      </button>
    </details>}
  </div>;
}
