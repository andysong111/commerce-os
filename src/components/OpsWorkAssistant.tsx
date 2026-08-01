"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type DetailPageJobStatus =
  | "collecting"
  | "queued"
  | "running"
  | "render_pending"
  | "success"
  | "failed"
  | "cancelled";

type DetailPageJob = {
  jobId: string;
  itemId: string;
  status: DetailPageJobStatus;
  stage: string;
  message: string;
  progress: number;
  qaStatus: string;
  attempt: number;
  error: string;
  payload?: Record<string, unknown>;
  updatedAt: string;
  completedAt: string | null;
};

const JOBS_API = "/api/product-launch-tracker/detail-page-jobs";
const DISMISSED_KEY = "commerce-os-work-assistant:dismissed-jobs:v1";
const COLLAPSED_KEY = "commerce-os-work-assistant:collapsed:v1";
const POLL_INTERVAL_MS = 2_500;
const RECENT_TERMINAL_MS = 12 * 60 * 60 * 1_000;
const ACTIVE_STATUSES = new Set<DetailPageJobStatus>([
  "collecting",
  "queued",
  "running",
  "render_pending",
]);

function safeProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function jobProductName(job: DetailPageJob) {
  const payload = job.payload ?? {};
  return String(
    payload.product_name || payload.product_name_hint || job.itemId || "상품",
  );
}

function jobStatus(job: DetailPageJob) {
  switch (job.status) {
    case "collecting":
      return { label: "현재 진행 중", detail: "1688 수집 중", tone: "blue" };
    case "queued":
      return { label: "현재 진행 중", detail: "서버 생성 대기", tone: "blue" };
    case "running":
      return { label: "현재 진행 중", detail: "서버 생성 중", tone: "blue" };
    case "render_pending":
      return { label: "현재 진행 중", detail: "최종 도킹 중", tone: "blue" };
    case "success":
      return { label: "완료", detail: "작업 완료", tone: "green" };
    case "failed":
      return { label: "확인 필요", detail: "작업 실패", tone: "red" };
    default:
      return { label: "취소됨", detail: "작업 취소", tone: "slate" };
  }
}

function readDismissedJobs() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DISMISSED_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

export function OpsWorkAssistant() {
  const workerRef = useRef<HTMLIFrameElement>(null);
  const [jobs, setJobs] = useState<DetailPageJob[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [workerReady, setWorkerReady] = useState(false);
  const [now, setNow] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(JOBS_API, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        jobs?: DetailPageJob[];
      };
      if (!response.ok || body.ok !== true || !Array.isArray(body.jobs)) return;
      setJobs(body.jobs);
      setNow(Date.now());
    } catch {
      // A transient polling failure must not hide the last known task state.
    }
  }, []);

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      setDismissed(readDismissedJobs());
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(hydrationTimer);
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);

  const visibleJobs = useMemo(
    () =>
      jobs
        .filter((job) => {
          if (ACTIVE_STATUSES.has(job.status)) return true;
          if (dismissed.has(job.jobId)) return false;
          const terminalTime = Date.parse(job.completedAt || job.updatedAt || "");
          return Number.isFinite(terminalTime) && now - terminalTime <= RECENT_TERMINAL_MS;
        })
        .sort((left, right) => {
          const activeDifference = Number(ACTIVE_STATUSES.has(right.status)) - Number(ACTIVE_STATUSES.has(left.status));
          if (activeDifference) return activeDifference;
          return Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "");
        })
        .slice(0, 12),
    [dismissed, jobs, now],
  );
  const activeCount = visibleJobs.filter((job) => ACTIVE_STATUSES.has(job.status)).length;

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  function dismissJob(jobId: string) {
    setDismissed((current) => {
      const next = new Set(current);
      next.add(jobId);
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next].slice(-100)));
      return next;
    });
  }

  function retryJob(itemId: string) {
    workerRef.current?.contentWindow?.postMessage(
      {
        source: "commerce-os-work-assistant",
        type: "retry-detail-page-job",
        itemId,
      },
      window.location.origin,
    );
  }

  return (
    <>
      <iframe
        ref={workerRef}
        title="OPS 백그라운드 작업 실행기"
        src="/product-launch-tracker-app/index.html?detail_page_mode=worker"
        aria-hidden="true"
        tabIndex={-1}
        onLoad={() => setWorkerReady(true)}
        className="pointer-events-none fixed -left-[2200px] top-0 z-[-1] h-[900px] w-[1280px] border-0 opacity-0"
      />

      {loaded && visibleJobs.length ? (
        <aside
          aria-label="실시간 작업 도우미"
          className="fixed bottom-24 right-4 z-[75] w-[min(400px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-300 bg-white text-slate-900 shadow-2xl sm:right-6"
        >
          <header className="flex items-center justify-between gap-4 bg-slate-950 px-4 py-3 text-white">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-black">실시간 작업 도우미</h2>
              <p className="mt-0.5 text-[11px] font-bold text-slate-300">
                {activeCount
                  ? `현재 진행 중인 작업 ${activeCount}건`
                  : `최근 완료·확인 작업 ${visibleJobs.length}건`}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-700 text-base font-black hover:bg-slate-600"
              aria-label={collapsed ? "작업 도우미 펼치기" : "작업 도우미 접기"}
            >
              {collapsed ? "+" : "−"}
            </button>
          </header>

          {!collapsed ? (
            <div className="max-h-[min(560px,calc(100vh-10rem))] space-y-2 overflow-y-auto bg-slate-50 p-2.5">
              {visibleJobs.map((job) => {
                const status = jobStatus(job);
                const active = ACTIVE_STATUSES.has(job.status);
                const progress = safeProgress(job.progress);
                const border =
                  status.tone === "green"
                    ? "border-l-emerald-500"
                    : status.tone === "red"
                      ? "border-l-rose-500"
                      : status.tone === "slate"
                        ? "border-l-slate-400"
                        : "border-l-blue-600";
                const badge =
                  status.tone === "green"
                    ? "bg-emerald-50 text-emerald-700"
                    : status.tone === "red"
                      ? "bg-rose-50 text-rose-700"
                      : status.tone === "slate"
                        ? "bg-slate-100 text-slate-600"
                        : "bg-blue-50 text-blue-700";
                const bar =
                  status.tone === "green"
                    ? "bg-emerald-500"
                    : status.tone === "red"
                      ? "bg-rose-500"
                      : status.tone === "slate"
                        ? "bg-slate-400"
                        : "bg-blue-600";

                return (
                  <article
                    key={job.jobId}
                    className={`rounded-xl border border-slate-200 border-l-4 ${border} bg-white p-3 shadow-sm`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black tracking-[0.12em] text-slate-400">
                          상세페이지 자동 생성
                        </p>
                        <h3 className="mt-1 truncate text-sm font-black">
                          {jobProductName(job)}
                        </h3>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${badge}`}>
                        {status.label}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                      <p className="min-w-0 truncate font-bold text-slate-600">
                        {job.message || status.detail}
                      </p>
                      <span className="shrink-0 font-black text-slate-500">{progress}%</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full rounded-full transition-[width] duration-300 ${bar}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    {job.error ? (
                      <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-rose-700">
                        {job.error}
                      </p>
                    ) : null}
                    <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-100 pt-2">
                      <p className="text-[10px] font-bold text-slate-400">
                        {active ? "화면 이동·새로고침 가능" : `시도 ${job.attempt || 1}회`}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/product-launch-tracker?detailPageItem=${encodeURIComponent(job.itemId)}`}
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-700 hover:bg-slate-100"
                        >
                          상품 상세
                        </Link>
                        {!active ? (
                          <>
                            <button
                              type="button"
                              onClick={() => retryJob(job.itemId)}
                              disabled={!workerReady}
                              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-40"
                            >
                              다시 생성
                            </button>
                            <button
                              type="button"
                              onClick={() => dismissJob(job.jobId)}
                              className="rounded-lg px-2 py-1.5 text-[11px] font-black text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                              aria-label={`${jobProductName(job)} 작업 알림 닫기`}
                            >
                              닫기
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
              <p className="px-1 pb-0.5 text-[10px] font-bold text-blue-600">
                작업은 서버와 공통 실행기에서 계속되며 다른 OPS 기능을 사용할 수 있습니다.
              </p>
            </div>
          ) : null}
        </aside>
      ) : null}
    </>
  );
}
