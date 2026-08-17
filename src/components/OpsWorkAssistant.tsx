"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type DetailStatus =
  | "collecting"
  | "queued"
  | "running"
  | "render_pending"
  | "success"
  | "failed"
  | "cancelled";

type DetailJob = {
  jobId: string;
  itemId: string;
  status: DetailStatus;
  stage: string;
  message: string;
  progress: number;
  qaStatus: string;
  attempt: number;
  sourceUrl?: string;
  sourceRunId?: string;
  error: string;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  updatedAt: string;
  completedAt: string | null;
};

type CategoryTone = "running" | "success" | "warning" | "failed";

type CategoryTask = {
  id: string;
  kind: "shopling_category_update";
  label: string;
  active: boolean;
  status: string;
  tone: CategoryTone;
  requestId: string;
  actionsUrl: string;
  startedAt: string;
  finishedAt: string;
  updatedAt: string;
  backgrounded: boolean;
  title: string;
  message: string;
  detail: string;
};

type CategoryStatusBody = {
  ok?: boolean;
  status?: {
    status?: string;
    requestId?: string;
    message?: string;
    categoryCount?: number;
  };
  snapshot?: {
    collectedAt?: string;
    categoryCount?: number;
  } | null;
};

type Tone = "blue" | "green" | "amber" | "red" | "slate";

const JOBS_API = "/api/product-launch-tracker/detail-page-jobs";
const ACTIVE_JOBS_API = "/api/product-launch-tracker/detail-page-jobs/active";
const CATEGORY_STATUS_API = "/api/shopling-categories/status";
const CATEGORY_TASK_KEY = "commerce-os-work-assistant:category-update:v1";
const CATEGORY_EVENT_SOURCE = "commerce-os-category-update";
const DETAIL_DOCK_EVENT_SOURCE = "commerce-os-detail-page-dock";
const WORK_ASSISTANT_SOURCE = "commerce-os-work-assistant";
const DISMISSED_KEY = "commerce-os-work-assistant:dismissed-jobs:v1";
const COLLAPSED_KEY = "commerce-os-work-assistant:collapsed:v1";
const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 30_000;
const HIDDEN_POLL_MS = 60_000;
const RECENT_MS = 12 * 60 * 60 * 1_000;
const ACTIVE_DETAIL = new Set<DetailStatus>([
  "collecting",
  "queued",
  "running",
  "render_pending",
]);

function txt(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function safeProgress(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? Math.round(value) : 0));
}

function detailName(job: DetailJob) {
  const payload = job.payload ?? {};
  return txt(payload.product_name || payload.product_name_hint || job.itemId || "상품");
}

function canResumeCheckpoint(job: DetailJob) {
  const evidence = job.payload?.evidence_urls;
  const analysis = job.result?.analysis;
  return Boolean(
    job.status === "failed" &&
      job.stage === "server_generation" &&
      Array.isArray(evidence) &&
      evidence.length > 0 &&
      analysis &&
      typeof analysis === "object" &&
      !Array.isArray(analysis) &&
      (analysis as Record<string, unknown>).product,
  );
}

function isDetailJob(value: unknown): value is DetailJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<DetailJob>;
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      txt(job.jobId),
    ) &&
    Boolean(txt(job.itemId)) &&
    ["collecting", "queued", "running", "render_pending", "success", "failed", "cancelled"].includes(
      txt(job.status),
    )
  );
}

function detailPresentation(job: DetailJob): {
  label: string;
  detail: string;
  tone: Tone;
} {
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

function categoryPresentation(task: CategoryTask): {
  label: string;
  detail: string;
  tone: Tone;
} {
  if (task.active || task.tone === "running") {
    return { label: "현재 진행 중", detail: task.detail, tone: "blue" };
  }
  if (task.tone === "success") {
    return { label: "완료", detail: "카테고리 업데이트 완료", tone: "green" };
  }
  if (task.tone === "warning") {
    return { label: "확인 필요", detail: "수동 로그인 필요", tone: "amber" };
  }
  return { label: "확인 필요", detail: "카테고리 업데이트 실패", tone: "red" };
}

function toneClasses(tone: Tone) {
  switch (tone) {
    case "green":
      return {
        border: "border-l-emerald-500",
        badge: "bg-emerald-50 text-emerald-700",
        bar: "bg-emerald-500",
      };
    case "amber":
      return {
        border: "border-l-amber-500",
        badge: "bg-amber-50 text-amber-700",
        bar: "bg-amber-500",
      };
    case "red":
      return {
        border: "border-l-rose-500",
        badge: "bg-rose-50 text-rose-700",
        bar: "bg-rose-500",
      };
    case "slate":
      return {
        border: "border-l-slate-400",
        badge: "bg-slate-100 text-slate-600",
        bar: "bg-slate-400",
      };
    default:
      return {
        border: "border-l-blue-600",
        badge: "bg-blue-50 text-blue-700",
        bar: "bg-blue-600",
      };
  }
}

function readDismissed() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DISMISSED_KEY) || "[]");
    return new Set<string>(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

function readCategoryTask(): CategoryTask | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CATEGORY_TASK_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    const source = parsed as Partial<CategoryTask>;
    const requestId = txt(source.requestId);
    const startedAt = txt(source.startedAt);
    const tone: CategoryTone =
      source.tone === "success" ||
      source.tone === "warning" ||
      source.tone === "failed"
        ? source.tone
        : "running";
    return {
      id: txt(source.id) || `shopling-category:${requestId || startedAt || "current"}`,
      kind: "shopling_category_update",
      label: txt(source.label) || "샵플링 카테고리 업데이트",
      active: source.active !== false,
      status: txt(source.status) || "running",
      tone,
      requestId,
      actionsUrl: txt(source.actionsUrl),
      startedAt,
      finishedAt: txt(source.finishedAt),
      updatedAt: txt(source.updatedAt),
      backgrounded: Boolean(source.backgrounded),
      title: txt(source.title) || "샵플링 카테고리 업데이트 진행 중",
      message: txt(source.message) || "샵플링 표준카테고리 목록을 읽고 있습니다.",
      detail: txt(source.detail) || "완료 여부 자동 확인 중",
    };
  } catch {
    return null;
  }
}

function writeCategoryTask(task: CategoryTask) {
  try {
    window.localStorage.setItem(CATEGORY_TASK_KEY, JSON.stringify(task));
  } catch {
    // Remote work must continue even if browser storage is temporarily unavailable.
  }
}

function isRecent(dateValue: string, now: number) {
  const timestamp = Date.parse(dateValue);
  return Number.isFinite(timestamp) && now - timestamp <= RECENT_MS;
}

function elapsed(startedAt: string, now: number) {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start) || !now) return "진행 시간 확인 중";
  const total = Math.max(0, Math.floor((now - start) / 1_000));
  const minutes = Math.floor(total / 60);
  return minutes ? `경과 ${minutes}분 ${total % 60}초` : `경과 ${total}초`;
}

export function OpsWorkAssistant() {
  const workerRef = useRef<HTMLIFrameElement>(null);
  const activeDetailRef = useRef(false);
  const [jobs, setJobs] = useState<DetailJob[]>([]);
  const [categoryTask, setCategoryTask] = useState<CategoryTask | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [removingJobs, setRemovingJobs] = useState<Set<string>>(new Set());
  const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [workerReady, setWorkerReady] = useState(false);
  const [now, setNow] = useState(0);

  const refreshDetailJobs = useCallback(async () => {
    try {
      const response = await fetch(JOBS_API, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        jobs?: DetailJob[];
      };
      if (response.ok && body.ok === true && Array.isArray(body.jobs)) {
        activeDetailRef.current = body.jobs.some((job) => ACTIVE_DETAIL.has(job.status));
        setJobs(body.jobs);
        return activeDetailRef.current;
      }
    } catch {
      // Keep the last known jobs visible during transient failures.
    }
    return activeDetailRef.current;
  }, []);

  const refreshDetailActivity = useCallback(async () => {
    try {
      const response = await fetch(ACTIVE_JOBS_API, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        active?: boolean | null;
      };
      if (response.ok && body.ok === true && typeof body.active === "boolean") {
        activeDetailRef.current = body.active;
        return body.active;
      }
    } catch {
      // Keep the last known activity state and probe again later.
    }
    return activeDetailRef.current;
  }, []);

  const refreshCategory = useCallback(async () => {
    let task: CategoryTask | null = readCategoryTask();
    if (!task) {
      setCategoryTask(null);
      return;
    }

    if (task.active) {
      try {
        const response = await fetch(CATEGORY_STATUS_API, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        const body = (await response.json().catch(() => ({}))) as CategoryStatusBody;
        if (response.ok && body.ok === true) {
          const status = body.status ?? {};
          const runStatus = txt(status.status);
          const sameRequest =
            Boolean(task.requestId) && txt(status.requestId) === task.requestId;
          const snapshotAt = Date.parse(body.snapshot?.collectedAt || "");
          const startedAt = Date.parse(task.startedAt || "");
          const newSnapshot =
            Number.isFinite(snapshotAt) &&
            Number.isFinite(startedAt) &&
            snapshotAt >= startedAt - 2_000;
          const finishedAt = new Date().toISOString();

          if ((sameRequest || newSnapshot) && runStatus === "success") {
            const count = Number(
              body.snapshot?.categoryCount || status.categoryCount || 0,
            );
            task = {
              ...task,
              active: false,
              status: "success",
              tone: "success",
              title: "샵플링 카테고리 업데이트 완료",
              message: count
                ? `샵플링 표준카테고리 ${count.toLocaleString("ko-KR")}개를 업데이트했습니다.`
                : txt(status.message) || "카테고리 업데이트가 완료됐습니다.",
              detail: "업데이트 완료",
              finishedAt,
              updatedAt: finishedAt,
            };
            writeCategoryTask(task);
          } else if (sameRequest && runStatus === "manual_login_required") {
            task = {
              ...task,
              active: false,
              status: "manual_login_required",
              tone: "warning",
              title: "샵플링 수동 로그인 필요",
              message:
                txt(status.message) ||
                "로그인 세션이 만료됐거나 보안문자 입력이 필요합니다.",
              detail: "로그인 세션 갱신 필요",
              finishedAt,
              updatedAt: finishedAt,
            };
            writeCategoryTask(task);
          } else if (sameRequest && runStatus === "failed") {
            task = {
              ...task,
              active: false,
              status: "failed",
              tone: "failed",
              title: "샵플링 카테고리 업데이트 실패",
              message:
                txt(status.message) || "카테고리 업데이트 중 오류가 발생했습니다.",
              detail: "실행 결과 확인 필요",
              finishedAt,
              updatedAt: finishedAt,
            };
            writeCategoryTask(task);
          } else {
            task = {
              ...task,
              status: runStatus || task.status || "running",
              tone: "running",
              detail: "GitHub Actions 완료 여부 자동 확인 중",
              updatedAt: new Date().toISOString(),
            };
          }
        }
      } catch {
        // Keep the last known task visible while polling recovers.
      }
    }

    setCategoryTask(task);
  }, []);

  const refreshAll = useCallback(
    async (forceDetailList = false) => {
      await refreshCategory();
      let active = activeDetailRef.current;
      if (forceDetailList || active) {
        active = await refreshDetailJobs();
      } else {
        active = await refreshDetailActivity();
        if (active) active = await refreshDetailJobs();
      }
      setNow(Date.now());
      return active;
    },
    [refreshCategory, refreshDetailActivity, refreshDetailJobs],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDismissed(readDismissed());
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");
      setCategoryTask(readCategoryTask());
      setNow(Date.now());
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onDetailDockMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const payload = event.data;
      if (
        payload?.source !== DETAIL_DOCK_EVENT_SOURCE ||
        payload?.type !== "detail-page-job-created" ||
        !isDetailJob(payload.job)
      ) return;

      const job = payload.job;
      activeDetailRef.current = true;
      setJobs((current) => [job, ...current.filter((item) => item.jobId !== job.jobId)]);
      setNow(Date.now());
      workerRef.current?.contentWindow?.postMessage(
        {
          source: WORK_ASSISTANT_SOURCE,
          type: "activate-detail-page-job",
          job,
        },
        window.location.origin,
      );
      window.setTimeout(() => void refreshDetailJobs(), 1_000);
    };
    window.addEventListener("message", onDetailDockMessage);
    return () => window.removeEventListener("message", onDetailDockMessage);
  }, [refreshDetailJobs]);

  useEffect(() => {
    const syncCategory = () => {
      setCategoryTask(readCategoryTask());
      setNow(Date.now());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === CATEGORY_TASK_KEY) syncCategory();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data?.source === CATEGORY_EVENT_SOURCE) {
        syncCategory();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;
    let inFlight = false;

    const schedule = (delay: number) => {
      if (stopped) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void tick(false), delay);
    };

    const tick = async (forceDetailList: boolean) => {
      if (stopped || inFlight) return;
      if (document.visibilityState !== "visible" && !forceDetailList) {
        schedule(HIDDEN_POLL_MS);
        return;
      }
      inFlight = true;
      try {
        const active = await refreshAll(forceDetailList);
        schedule(active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
      } finally {
        inFlight = false;
      }
    };

    const whenVisible = () => {
      if (document.visibilityState === "visible") void tick(false);
    };

    void tick(true);
    window.addEventListener("focus", whenVisible);
    document.addEventListener("visibilitychange", whenVisible);
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("focus", whenVisible);
      document.removeEventListener("visibilitychange", whenVisible);
    };
  }, [refreshAll]);

  const visibleJobs = useMemo(
    () =>
      jobs
        .filter((job) => {
          if (txt(job.payload?.assistant_hidden_at)) return false;
          if (ACTIVE_DETAIL.has(job.status)) return true;
          if (dismissed.has(job.jobId)) return false;
          return isRecent(job.completedAt || job.updatedAt || "", now);
        })
        .sort((left, right) => {
          const activeOrder =
            Number(ACTIVE_DETAIL.has(right.status)) - Number(ACTIVE_DETAIL.has(left.status));
          return activeOrder || Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "");
        })
        .slice(0, 12),
    [dismissed, jobs, now],
  );

  const visibleCategory = useMemo(() => {
    if (!categoryTask) return null;
    if (categoryTask.active) return categoryTask;
    if (dismissed.has(categoryTask.id)) return null;
    return isRecent(categoryTask.finishedAt || categoryTask.updatedAt || "", now)
      ? categoryTask
      : null;
  }, [categoryTask, dismissed, now]);

  const activeCount =
    visibleJobs.filter((job) => ACTIVE_DETAIL.has(job.status)).length +
    (visibleCategory?.active ? 1 : 0);
  const visibleCount = visibleJobs.length + (visibleCategory ? 1 : 0);

  function dismiss(id: string) {
    setDismissed((current) => {
      const next = new Set(current);
      next.add(id);
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next].slice(-100)));
      return next;
    });
  }

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  function retryDetail(itemId: string) {
    activeDetailRef.current = true;
    workerRef.current?.contentWindow?.postMessage(
      {
        source: WORK_ASSISTANT_SOURCE,
        type: "retry-detail-page-job",
        itemId,
      },
      window.location.origin,
    );
  }

  async function removeFailedDetail(job: DetailJob) {
    if (job.status !== "failed" || removingJobs.has(job.jobId)) return;
    const confirmed = window.confirm(
      `\"${detailName(job)}\" 실패 기록을 작업 도우미에서 삭제할까요?\n상품과 생성 이력은 삭제되지 않습니다.`,
    );
    if (!confirmed) return;

    setRemovingJobs((current) => new Set(current).add(job.jobId));
    setRemoveErrors((current) => {
      const next = { ...current };
      delete next[job.jobId];
      return next;
    });
    try {
      const response = await fetch(`${JOBS_API}/${encodeURIComponent(job.jobId)}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "dismiss_failed_from_assistant" }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || body.ok !== true) {
        throw new Error(txt(body.message) || "실패 기록을 삭제하지 못했습니다.");
      }
      setJobs((current) => current.filter((item) => item.jobId !== job.jobId));
    } catch (error) {
      setRemoveErrors((current) => ({
        ...current,
        [job.jobId]:
          error instanceof Error ? error.message : "실패 기록을 삭제하지 못했습니다.",
      }));
    } finally {
      setRemovingJobs((current) => {
        const next = new Set(current);
        next.delete(job.jobId);
        return next;
      });
    }
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

      {loaded && visibleCount ? (
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
                  : `최근 완료·확인 작업 ${visibleCount}건`}
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
              {visibleCategory ? (
                <CategoryCard
                  task={visibleCategory}
                  now={now}
                  onDismiss={() => dismiss(visibleCategory.id)}
                />
              ) : null}
              {visibleJobs.map((job) => (
                <DetailCard
                  key={job.jobId}
                  job={job}
                  workerReady={workerReady}
                  onRetry={() => retryDetail(job.itemId)}
                  onDismiss={() => dismiss(job.jobId)}
                  onRemove={() => void removeFailedDetail(job)}
                  removing={removingJobs.has(job.jobId)}
                  removeError={removeErrors[job.jobId] || ""}
                />
              ))}
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

function CategoryCard({
  task,
  now,
  onDismiss,
}: {
  task: CategoryTask;
  now: number;
  onDismiss: () => void;
}) {
  const status = categoryPresentation(task);
  const classes = toneClasses(status.tone);
  return (
    <article
      className={`rounded-xl border border-slate-200 border-l-4 ${classes.border} bg-white p-3 shadow-sm`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black tracking-[0.12em] text-slate-400">
            샵플링 기준정보 동기화
          </p>
          <h3 className="mt-1 truncate text-sm font-black">{task.title || task.label}</h3>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${classes.badge}`}>
          {status.label}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-xs font-bold leading-5 text-slate-600">
        {task.message || status.detail}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${classes.bar} ${task.active ? "w-2/5 animate-pulse" : "w-full"}`}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-100 pt-2">
        <p className="text-[10px] font-bold text-slate-400">
          {task.active ? elapsed(task.startedAt, now) : status.detail}
        </p>
        <div className="flex items-center gap-1.5">
          {task.actionsUrl ? (
            <a
              href={task.actionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-700 hover:bg-slate-100"
            >
              Actions
            </a>
          ) : null}
          <Link
            href="/product-launch-tracker"
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-700 hover:bg-slate-100"
          >
            업데이트 화면
          </Link>
          {!task.active ? (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg px-2 py-1.5 text-[11px] font-black text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              닫기
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function DetailCard({
  job,
  workerReady,
  onRetry,
  onDismiss,
  onRemove,
  removing,
  removeError,
}: {
  job: DetailJob;
  workerReady: boolean;
  onRetry: () => void;
  onDismiss: () => void;
  onRemove: () => void;
  removing: boolean;
  removeError: string;
}) {
  const status = detailPresentation(job);
  const classes = toneClasses(status.tone);
  const active = ACTIVE_DETAIL.has(job.status);
  const resumable = canResumeCheckpoint(job);
  const progress = safeProgress(job.progress);
  return (
    <article
      className={`rounded-xl border border-slate-200 border-l-4 ${classes.border} bg-white p-3 shadow-sm`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black tracking-[0.12em] text-slate-400">
            상세페이지 자동 생성
          </p>
          <h3 className="mt-1 truncate text-sm font-black">{detailName(job)}</h3>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${classes.badge}`}>
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
          className={`h-full rounded-full transition-[width] duration-300 ${classes.bar}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      {job.error ? (
        <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-rose-700">{job.error}</p>
      ) : null}
      {removeError ? (
        <p className="mt-2 text-[11px] font-bold leading-4 text-rose-700">{removeError}</p>
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
                onClick={onRetry}
                disabled={!workerReady}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-40"
              >
                {resumable ? "이어서 생성" : "다시 생성"}
              </button>
              {job.status === "failed" ? (
                <button
                  type="button"
                  onClick={onRemove}
                  disabled={removing}
                  className="rounded-lg px-2 py-1.5 text-[11px] font-black text-rose-600 hover:bg-rose-50 disabled:cursor-wait disabled:opacity-50"
                >
                  {removing ? "삭제 중…" : "삭제"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="rounded-lg px-2 py-1.5 text-[11px] font-black text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  닫기
                </button>
              )}
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}
