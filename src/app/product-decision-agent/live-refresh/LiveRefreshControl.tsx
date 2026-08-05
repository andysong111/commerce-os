"use client";

import { useEffect, useState } from "react";
import type { ProductDecisionLiveStatus } from "@/lib/productDecisionLiveRefresh";

export function LiveRefreshControl({
  initialStatus,
}: {
  initialStatus: ProductDecisionLiveStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialStatus.message);

  const active = status.state === "QUEUED" || status.state === "RUNNING";

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
      message?: string;
    };
    if (!response.ok || body.ok !== true || !body.status) {
      throw new Error(body.message || "실시간 발주 계산 상태를 읽지 못했습니다.");
    }
    setStatus(body.status);
    setMessage(body.status.message);
  }

  async function start() {
    if (busy || active) return;
    setBusy(true);
    setMessage("실시간 판매 발주 계산을 접수하고 있습니다.");
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
        requestId?: string;
        status?: ProductDecisionLiveStatus;
        message?: string;
      };
      if (!response.ok || body.ok !== true) {
        throw new Error(body.message || "실시간 발주 계산을 시작하지 못했습니다.");
      }
      if (body.status) {
        setStatus(body.status);
        setMessage(body.message || body.status.message);
      } else {
        await readStatus(body.requestId ?? null);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "실시간 발주 계산을 시작하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function runNext() {
    if (busy || !active) return;
    setBusy(true);
    setMessage("작업 한 구간을 수동 실행하고 있습니다.");
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
            : "실시간 발주 계산 상태를 갱신하지 못했습니다.",
        );
      });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [active, status.requestId]);

  return (
    <div className="space-y-5">
      <section
        className={`rounded-2xl border p-5 text-sm ${
          status.state === "COMPLETED"
            ? "border-emerald-200 bg-emerald-50 text-emerald-950"
            : status.state === "FAILED"
              ? "border-rose-200 bg-rose-50 text-rose-950"
              : "border-blue-200 bg-blue-50 text-blue-950"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong className="block text-base">
              실시간 발주 계산 · {status.state}
            </strong>
            <p className="mt-2 leading-6">{message}</p>
          </div>
          <span className="rounded-full border border-current/20 bg-white px-3 py-1 text-xs font-black">
            실제 주문 쓰기 차단
          </span>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="진행률" value={`${status.progress}%`} note={status.stage} />
        <Metric
          label="주문 구간"
          value={`${status.orderCompleted}/${status.orderTotal}`}
          note="1회 최대 7일"
        />
        <Metric
          label="클레임 구간"
          value={`${status.claimCompleted}/${status.claimTotal}`}
          note="1회 최대 90일"
        />
        <Metric
          label="계산 기준"
          value={
            status.analysisAsOf
              ? new Date(status.analysisAsOf).toLocaleString("ko-KR")
              : "없음"
          }
          note="요청시점 고정"
          compact
        />
        <Metric
          label="환경설정"
          value={status.configured ? "준비됨" : "미설정"}
          note="샵플링·상품마스터 읽기"
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
            disabled={busy || active || !status.configured}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {active ? "실시간 발주 계산 진행 중" : "최신 판매로 그림자 발주안 만들기"}
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
          화면을 닫아도 1분 예약 Worker가 한 구간씩 계속 처리합니다. 같은
          구간은 source_event_id로 중복 저장하지 않고, 실패 구간만 최대 3회
          재시도합니다.
        </p>
      </section>

      {status.finalSnapshot ? (
        <section className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">
            실시간 그림자 발주안 완료
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
              note="전체 재계산"
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
            이 결과는 아직 운영 발주안으로 승격하지 않았으며 실제 주문·중국
            전송을 실행하지 않습니다.
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
