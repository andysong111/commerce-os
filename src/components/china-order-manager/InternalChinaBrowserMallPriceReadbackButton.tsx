"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function InternalChinaBrowserMallPriceReadbackButton({
  proposalFingerprint,
  failedGoodsKeyCount,
}: {
  proposalFingerprint: string;
  failedGoodsKeyCount: number;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  async function start() {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch(
        "/api/china-order-manager/price-review/browser-readback",
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify({
            proposalFingerprint,
            delayMs: 0,
            retryFailed: failedGoodsKeyCount > 0,
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || body.ok !== true) {
        throw new Error(body.message || `Shopling 브라우저 재검증 준비 실패 (${response.status})`);
      }
      setNotice(body.message || "Shopling 브라우저 재검증 대기열을 준비했습니다.");
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Shopling 브라우저 재검증 대기열을 준비하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={saving}
        onClick={start}
        className="rounded-xl border border-indigo-300 bg-white px-4 py-2.5 text-xs font-black text-indigo-800 shadow-sm hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving
          ? "읽기 전용 재검증 준비 중..."
          : failedGoodsKeyCount > 0
            ? `확인필요 ${failedGoodsKeyCount.toLocaleString("ko-KR")}건 다시 재검증`
            : "쇼핑몰별 가격 브라우저 재검증"}
      </button>
      {notice ? <p className="max-w-md text-xs leading-5 text-slate-700">{notice}</p> : null}
    </div>
  );
}
