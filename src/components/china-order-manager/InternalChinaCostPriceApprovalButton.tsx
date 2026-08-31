"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function InternalChinaCostPriceApprovalButton({
  proposalFingerprint,
  changedRowCount,
}: {
  proposalFingerprint: string;
  changedRowCount: number;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  async function approve() {
    if (
      !window.confirm(
        `가격변경 대상 ${changedRowCount.toLocaleString("ko-KR")}개 옵션행의 조정안을 승인할까요?\n\n이 버튼은 승인 기록만 남깁니다. 실제 Shopling 판매가격은 아직 변경하지 않습니다.`,
      )
    ) {
      return;
    }

    setSaving(true);
    setNotice("");
    try {
      const response = await fetch(
        "/api/china-order-manager/price-review/approve",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify({ proposalFingerprint }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || body.ok !== true) {
        throw new Error(body.message || `가격조정안 승인 실패 (${response.status})`);
      }
      setNotice(body.message || "가격조정안 승인을 기록했습니다.");
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "가격조정안 승인을 기록하지 못했습니다.",
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
        onClick={approve}
        className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "승인 기록 중..." : `가격조정안 승인 · ${changedRowCount.toLocaleString("ko-KR")}개`}
      </button>
      {notice ? <p className="text-xs leading-5 text-slate-600">{notice}</p> : null}
    </div>
  );
}
