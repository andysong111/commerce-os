"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InternalChinaFundingCloseSummary } from "@/lib/internalChinaFundingClose";

const number = new Intl.NumberFormat("ko-KR");

function won(value: unknown) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function decimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100) / 100) : 0;
}

export function InternalChinaFundingClosePanel({
  draftId,
  cycleMonth,
  totalSpendingBudgetKrw,
  actualForwarderCostKrw,
  stored,
}: {
  draftId: string;
  cycleMonth: string;
  totalSpendingBudgetKrw: number;
  actualForwarderCostKrw: number;
  stored: InternalChinaFundingCloseSummary | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(!stored);
  const [notice, setNotice] = useState("");
  const [worldFirstTransferInput, setWorldFirstTransferInput] = useState(
    stored ? String(stored.worldFirstTransferKrw) : "",
  );
  const [worldFirstEndingUsdInput, setWorldFirstEndingUsdInput] = useState(
    stored ? String(stored.worldFirstEndingUsd) : "",
  );
  const [worldFirstEndingCnhInput, setWorldFirstEndingCnhInput] = useState(
    stored ? String(stored.worldFirstEndingCnh) : "",
  );
  const [koreaAccountSpentInput, setKoreaAccountSpentInput] = useState(
    stored ? String(stored.koreaAccountSpentKrw) : String(actualForwarderCostKrw),
  );

  const worldFirstTransferKrw = won(worldFirstTransferInput);
  const worldFirstEndingUsd = decimal(worldFirstEndingUsdInput);
  const worldFirstEndingCnh = decimal(worldFirstEndingCnhInput);
  const koreaAccountSpentKrw = won(koreaAccountSpentInput);
  const koreaAccountAvailableKrw = Math.max(
    0,
    totalSpendingBudgetKrw - worldFirstTransferKrw,
  );
  const emergencyReserveTransferKrw = Math.max(
    0,
    koreaAccountAvailableKrw - koreaAccountSpentKrw,
  );
  const invalid =
    totalSpendingBudgetKrw <= 0 ||
    worldFirstTransferKrw <= 0 ||
    worldFirstTransferKrw > totalSpendingBudgetKrw ||
    koreaAccountSpentKrw < actualForwarderCostKrw ||
    koreaAccountSpentKrw > koreaAccountAvailableKrw;

  async function save() {
    if (invalid) {
      setNotice("WorldFirst 송금액과 한국계좌 실제 지출액을 확인하세요.");
      return;
    }
    if (
      !window.confirm(
        `월 자금을 마감할까요?\n\n전체 지출가능금액 ${number.format(totalSpendingBudgetKrw)}원\nWorldFirst 송금 ${number.format(worldFirstTransferKrw)}원\n한국계좌 배정 ${number.format(koreaAccountAvailableKrw)}원\n한국계좌 실제지출 ${number.format(koreaAccountSpentKrw)}원\n비상금 적립 ${number.format(emergencyReserveTransferKrw)}원\nWorldFirst 기말잔액 USD ${worldFirstEndingUsd.toLocaleString("en-US")} / CNH ${worldFirstEndingCnh.toLocaleString("en-US")}\n\nWorldFirst 송금은 비용이 아니라 자금이동으로 기록합니다. 한국계좌 남은금액은 전액 비상금 적립으로 마감합니다.`,
      )
    ) {
      return;
    }

    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/china-order-manager/funding-close", {
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
          worldFirstTransferKrw,
          worldFirstEndingUsd,
          worldFirstEndingCnh,
          koreaAccountSpentKrw,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || body.ok !== true) {
        throw new Error(body.message || `월 자금 마감 실패 (${response.status})`);
      }
      setNotice(body.message || "월 자금 마감을 저장했습니다.");
      setEditing(false);
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "월 자금 마감을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-black text-emerald-950">월 자금 마감</h3>
            {stored && !editing ? (
              <span className="rounded-full border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-black text-emerald-800">
                자금 마감 완료
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-emerald-900">
            입고·실제원가 마감 후 WorldFirst 자금이동과 기말잔고, 한국계좌 실제지출, 비상금 적립만 기록합니다. 복잡한 회계원장이 아니라 월별 두 지갑 마감표입니다.
          </p>
        </div>
        {stored && !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-black text-emerald-800"
          >
            자금 마감 수정
          </button>
        ) : null}
      </div>

      {!editing && stored ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <FundingMetric label="전체 지출가능" value={`${number.format(stored.totalSpendingBudgetKrw)}원`} />
          <FundingMetric label="WorldFirst 송금" value={`${number.format(stored.worldFirstTransferKrw)}원`} />
          <FundingMetric label="WF 기말 USD" value={stored.worldFirstEndingUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })} />
          <FundingMetric label="WF 기말 CNH" value={stored.worldFirstEndingCnh.toLocaleString("en-US", { maximumFractionDigits: 2 })} />
          <FundingMetric label="한국계좌 실제지출" value={`${number.format(stored.koreaAccountSpentKrw)}원`} />
          <FundingMetric label="비상금 적립" value={`${number.format(stored.emergencyReserveTransferKrw)}원`} emphasized />
        </div>
      ) : (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <FundingInput
              label="WorldFirst 송금액(원)"
              value={worldFirstTransferInput}
              onChange={setWorldFirstTransferInput}
              placeholder="예: 3715085"
              step="1"
            />
            <FundingInput
              label="WorldFirst 기말 USD"
              value={worldFirstEndingUsdInput}
              onChange={setWorldFirstEndingUsdInput}
              placeholder="예: 562.33"
              step="0.01"
            />
            <FundingInput
              label="WorldFirst 기말 CNH"
              value={worldFirstEndingCnhInput}
              onChange={setWorldFirstEndingCnhInput}
              placeholder="예: 6161.32"
              step="0.01"
            />
            <FundingInput
              label="한국계좌 실제 지출액(원)"
              value={koreaAccountSpentInput}
              onChange={setKoreaAccountSpentInput}
              placeholder="예: 907820"
              step="1"
            />
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <FundingMetric label="전체 지출가능금액" value={`${number.format(totalSpendingBudgetKrw)}원`} />
            <FundingMetric label="한국계좌 배정 가능액" value={`${number.format(koreaAccountAvailableKrw)}원`} />
            <FundingMetric label="한국계좌 사용 후 잔액" value={`${number.format(emergencyReserveTransferKrw)}원`} />
            <FundingMetric label="비상금 계좌 적립액" value={`${number.format(emergencyReserveTransferKrw)}원`} emphasized />
          </div>

          <p className="mt-3 rounded-lg bg-white px-3 py-2 text-[11px] font-bold leading-5 text-emerald-950">
            전체 지출가능금액 = 직전월 정상매출 ÷ 2. WorldFirst 송금은 비용이 아니라 자금이동이며, 잔액은 USD/CNH 원통화 그대로 저장합니다. 한국계좌 배정액 = 전체 지출가능금액 - WorldFirst 송금액, 비상금 적립액 = 한국계좌 배정액 - 한국계좌 실제지출액으로 자동 계산합니다.
          </p>

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              disabled={saving || invalid}
              onClick={() => void save()}
              className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "자금 마감 저장 중…" : stored ? "월 자금 마감 수정 저장" : "월 자금 마감"}
            </button>
          </div>
        </>
      )}

      {notice ? (
        <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs leading-5 text-slate-700">{notice}</p>
      ) : null}
    </div>
  );
}

function FundingInput({
  label,
  value,
  onChange,
  placeholder,
  step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  step: string;
}) {
  return (
    <label className="rounded-lg border border-emerald-200 bg-white p-3">
      <span className="block text-xs font-bold text-slate-600">{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-right font-black outline-none focus:border-emerald-500"
      />
    </label>
  );
}

function FundingMetric({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div className={`rounded-lg border bg-white p-3 ${emphasized ? "border-emerald-400" : "border-emerald-200"}`}>
      <span className="block text-[11px] font-bold text-slate-500">{label}</span>
      <strong className={`mt-1 block text-right text-sm font-black ${emphasized ? "text-emerald-800" : "text-slate-950"}`}>
        {value}
      </strong>
    </div>
  );
}
