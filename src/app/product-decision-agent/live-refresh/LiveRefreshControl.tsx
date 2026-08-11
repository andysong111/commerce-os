"use client";

import { useEffect, useState } from "react";
import type { MonthlyPurchaseCycleGate } from "@/lib/monthlyPurchaseCycleGate";
import { koreanMonthLabel } from "@/lib/monthlyPurchasePolicy";
import type { ProductDecisionLiveStatus } from "@/lib/productDecisionLiveRefresh";

export function LiveRefreshControl({
  initialStatus,
  initialPolicy,
}: {
  initialStatus: ProductDecisionLiveStatus;
  initialPolicy: MonthlyPurchaseCycleGate;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [policy, setPolicy] = useState(initialPolicy);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialStatus.message);

  const active = status.state === "QUEUED" || status.state === "RUNNING";
  const monthlyLocked = policy.locked && !active;

  async function readStatus(requestId?: string | null) {
    const query = requestId
      ? `?requestId=${encodeURIComponent(requestId)}`
      : "";
    const response = await fetch(
      `/api/product-decision-agent/live-refresh${query}`,
      { cache: "no-store" },
    );
    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      status?: ProductDecisionLiveStatus;
      monthlyPolicy?: MonthlyPurchaseCycleGate;
      message?: string;
    };
    if (!response.ok || body.ok !== true || !body.status) {
      throw new Error(body.message || "월간 발주 계산 상태를 읽지 못했습니다.");
    }
    setStatus(body.status);
    if (body.monthlyPolicy) setPolicy(body.monthlyPolicy);
    setMessage(body.status.message);
  }

  async function start() {
    if (busy || active || monthlyLocked) return;
    setBusy(true);
    setMessage("이번 달 발주 계산을 접수하고 있습니다.");
    try {
      const response = await fetch(
        "/api/product-decision-agent/live-refresh",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "start" }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        accepted?: boolean;
        monthlyLocked?: boolean;
        requestId?: string;
        status?: ProductDecisionLiveStatus;
        monthlyPolicy?: MonthlyPurchaseCycleGate;
        message?: string;
      };
      if (!response.ok || body.ok !== true) {
        throw new Error(body.message || "월간 발주 계산을 시작하지 못했습니다.");
      }
      if (body.monthlyPolicy) setPolicy(body.monthlyPolicy);
      if (body.status) setStatus(body.status);
      setMessage(body.message || body.status?.message || "월간 발주 계산을 접수했습니다.");
      if (!body.status && body.requestId) {
        await readStatus(body.requestId);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "월간 발주 계산을 시작하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function runNext() {
    if (busy || !active) return;
    setBusy(true);
    setMessage("월간 발주 계산의 다음 구간을 실행하고 있습니다.");
    try {
      const response = await fetch(
        "/api/product-decision-agent/live-refresh",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "run-next" }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || body.ok !== true) {
        throw new Error(body.message || "작업 구간 실행에 실패했습니다.");
      }
      await readStatus(status.requestId);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "작업 구간 실행에 실패했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      void readStatus(status.requestId).catch((error) => {
        setMessage(
          error instanceof Error
            ? error.message
            : "월간 발주 계산 상태를 갱신하지 못했습니다.",
        );
      });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [active, status.requestId]);

  const cycleLabel = policy.cycleMonth
    ? koreanMonthLabel(policy.cycleMonth)
    : "이번 달";
  const budgetLabel = policy.budgetMonth
    ? koreanMonthLabel(policy.budgetMonth)
    : "직전 달";

  return (
    <div className="space-y-5">
      <section
        className={`rounded-2xl border p-5 text-sm ${
          monthlyLocked || status.state === "COMPLETED"
            ? "border-emerald-200 bg-emerald-50 text-emerald-950"
            : status.state === "FAILED"
              ? "border-rose-200 bg-rose-50 text-rose-950"
              : "border-blue-200 bg-blue-50 text-blue-950"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong className="block text-base">
              월간 발주 계산 · {status.state}
            </strong>
            <p className="mt-2 leading-6">{message}</p>
            {monthlyLocked ? (
              <p className="mt-2 text-xs font-bold">
                {cycleLabel} 발주안 생성권은 사용 완료 · 다음 발주차시는 다음 달에 열립니다.
              </p>
            ) : null}
          </div>
          <span className="rounded-full border border-current/20 bg-white px-3 py-1 text-xs font-black">
            월 1회 · 실제 주문 쓰기 차단
          </span>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="진행률" value={`${status.progress}%`} note={status.stage} />
        <Metric
          label="주문 구간"
          value={`${status.orderCompleted}/${status.orderTotal}`}
          note="수요분석 최근 360일"
        />
        <Metric
          label="클레임 구간"
          value={`${status.claimCompleted}/${status.claimTotal}`}
          note="품질 보조신호"
        />
        <Metric label="발주차시" value={cycleLabel} note="월 1회 생성" compact />
        <Metric label="예산 기준" value={budgetLabel} note="1일~말일 정상매출" compact />
        <Metric
          label="환경설정"
          value={status.configured ? "준비됨" : "미설정"}
          note="Shopling·Product Master 읽기"
          danger={!status.configured}
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="h-3 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-blue-600 transition-[width]"
            style={{ width: `${status.progress}%` }}
          />
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void start()}
            disabled={
              busy || active || monthlyLocked || !status.configured
            }
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {active
              ? "월간 발주 계산 진행 중"
              : monthlyLocked
                ? `${cycleLabel} 발주안 생성완료`
                : `${cycleLabel} 발주안 만들기`}
          </button>
          {active ? (
            <button
              type="button"
              onClick={() => void runNext()}
              disabled={busy}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              한 구간 즉시 실행
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void readStatus(status.requestId)}
            disabled={busy}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            상태 새로고침
          </button>
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-500">
          발주 추천 생성권만 월 단위로 잠급니다. 화면을 닫아도 예약 Worker가
          시작된 월간 계산을 끝까지 처리합니다. 상품등급·가격조정의 판매이력
          갱신과 일일 판단은 이 잠금과 독립적으로 계속 동작합니다.
        </p>
      </section>

      {status.finalSnapshot ? (
        <section className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">
            월간 그림자 발주안 완료
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="상품"
              value={String(status.finalSnapshot.products?.length ?? 0)}
              note="위치코드형 대상"
            />
            <Metric
              label="예상 발주금액"
              value={`${Number(status.finalSnapshot.expectedSpend ?? 0).toLocaleString("ko-KR")}원`}
              note={`${budgetLabel} 예산 기준`}
            />
            <Metric
              label="권장수량 변경"
              value={String(status.comparison?.quantityChangedCount ?? 0)}
              note="기존 검증안 대비"
            />
            <Metric
              label="판정 변경"
              value={String(status.comparison?.statusChangedCount ?? 0)}
              note="그림자 비교"
            />
          </div>
          <p className="mt-4 text-xs text-emerald-800">
            이 결과는 실제 1688 주문을 실행하지 않습니다. 같은 달에는 새 발주안을
            다시 만들지 않고 이 월간 결과와 내부 Draft를 계속 사용합니다.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  compact = false,
  danger = false,
}: {
  label: string;
  value: string;
  note: string;
  compact?: boolean;
  danger?: boolean;
}) {
  return (
    <article
      className={`rounded-2xl border bg-white p-5 shadow-sm ${
        danger ? "border-rose-200" : "border-slate-200"
      }`}
    >
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <strong
        className={`mt-2 block break-words font-black ${
          danger ? "text-rose-700" : "text-slate-950"
        } ${compact ? "text-sm" : "text-2xl"}`}
      >
        {value}
      </strong>
      <p className="mt-2 text-xs text-slate-500">{note}</p>
    </article>
  );
}
