"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function InternalChinaGroupCostPriceExecutionButton({
  proposalFingerprint,
  changedOptionRowCount,
  goodsKeyCount,
  maxIncreaseRate,
}: {
  proposalFingerprint: string;
  changedOptionRowCount: number;
  goodsKeyCount: number;
  maxIncreaseRate: number;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const maxPercent = (maxIncreaseRate * 100).toFixed(1);

  async function execute() {
    if (
      !window.confirm(
        `승인된 ${goodsKeyCount.toLocaleString("ko-KR")}개 GOODSKEY · ${changedOptionRowCount.toLocaleString("ko-KR")}개 옵션행의 가격을 확정원가 기준 목표가까지 한 번에 올릴까요?\n\n인상률 상한은 두지 않습니다. 현재 최대 인상폭은 약 +${maxPercent}%입니다. 각 GOODSKEY의 상품 기본가격과 해당 상품그룹에 연결된 쇼핑몰 가격만 목표가로 전송합니다. 그룹 미확정·판매중지·차단 행은 포함되지 않습니다.`,
      )
    ) {
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch(
        "/api/china-order-manager/price-review/group-aware-execute",
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
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
        throw new Error(body.message || `Shopling 목표가 적용 전송 실패 (${response.status})`);
      }
      setNotice(body.message || "Shopling 목표가 적용 작업을 전송했습니다.");
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Shopling 목표가 적용 작업을 전송하지 못했습니다.",
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
        onClick={execute}
        className="rounded-xl bg-rose-700 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving
          ? "Shopling 적용 작업 전송 중..."
          : `확정원가 목표가 일괄 적용 · ${goodsKeyCount.toLocaleString("ko-KR")} GOODSKEY`}
      </button>
      <p className="max-w-sm text-xs leading-5 text-slate-600">
        인상률 제한 없이 계산된 최종 목표가를 그대로 사용합니다. 기술 배치는 나누지만 각 상품 가격은 단계 인상 없이 최종가로 한 번에 이동합니다.
      </p>
      {notice ? <p className="text-xs leading-5 text-slate-700">{notice}</p> : null}
    </div>
  );
}
