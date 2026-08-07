"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  detailPageJobName,
  detailPageStageLabel,
  isActiveDetailPageJob,
  type DetailPageReviewJob,
} from "@/lib/detailPageAiReview";

const JOBS_API = "/api/product-launch-tracker/detail-page-jobs";
const POLL_MS = 2_500;

type ActionResult = {
  tone: "success" | "error";
  message: string;
} | null;

export function DetailPageActiveJobControls() {
  const [jobs, setJobs] = useState<DetailPageReviewJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [result, setResult] = useState<ActionResult>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(JOBS_API, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        jobs?: DetailPageReviewJob[];
        message?: string;
      };
      if (!response.ok || body.ok !== true || !Array.isArray(body.jobs)) {
        throw new Error(body.message || "진행 중 상세페이지 작업을 읽지 못했습니다.");
      }
      setJobs(body.jobs.filter(isActiveDetailPageJob));
    } catch (error) {
      if (!quiet) {
        setResult({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "진행 중 작업을 읽지 못했습니다.",
        });
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(true), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const busy = busyIds.length > 0;
  const sortedJobs = useMemo(
    () =>
      [...jobs].sort(
        (left, right) =>
          Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""),
      ),
    [jobs],
  );

  async function cancelJob(job: DetailPageReviewJob, removeAfter: boolean) {
    if (busyIds.includes(job.jobId)) return;
    const confirmed = window.confirm(
      removeAfter
        ? `"${detailPageJobName(job)}" 작업을 즉시 취소하고 AI 작업검수 목록에서 삭제할까요?\n이미 상품상세에 도킹된 기존 대표·부가·상세페이지 결과는 유지됩니다.`
        : `"${detailPageJobName(job)}" 작업을 즉시 취소할까요?\n이미 상품상세에 도킹된 기존 결과는 유지됩니다.`,
    );
    if (!confirmed) return;
    setBusyIds((current) => [...current, job.jobId]);
    setResult(null);
    try {
      await cancelAndMaybeDelete(job, removeAfter);
      setJobs((current) => current.filter((item) => item.jobId !== job.jobId));
      setResult({
        tone: "success",
        message: removeAfter
          ? `"${detailPageJobName(job)}" 작업을 취소하고 목록에서 삭제했습니다.`
          : `"${detailPageJobName(job)}" 작업을 취소했습니다.`,
      });
      window.dispatchEvent(new CustomEvent("detail-page-ai-review:jobs-changed"));
      await refresh(true);
    } catch (error) {
      setResult({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "상세페이지 작업을 취소하지 못했습니다.",
      });
    } finally {
      setBusyIds((current) => current.filter((id) => id !== job.jobId));
    }
  }

  async function cancelAll(removeAfter: boolean) {
    if (busy || !sortedJobs.length) return;
    const confirmed = window.confirm(
      removeAfter
        ? `현재 진행 중인 상세페이지 작업 ${sortedJobs.length}건을 모두 취소하고 AI 작업검수 목록에서 삭제할까요?\n이미 도킹된 기존 상품상세 결과는 유지됩니다.`
        : `현재 진행 중인 상세페이지 작업 ${sortedJobs.length}건을 모두 취소할까요?\n이미 도킹된 기존 상품상세 결과는 유지됩니다.`,
    );
    if (!confirmed) return;
    const ids = sortedJobs.map((job) => job.jobId);
    setBusyIds(ids);
    setResult(null);
    const results = await Promise.allSettled(
      sortedJobs.map((job) => cancelAndMaybeDelete(job, removeAfter)),
    );
    const failed = results.filter((item) => item.status === "rejected");
    setBusyIds([]);
    setResult({
      tone: failed.length ? "error" : "success",
      message: failed.length
        ? `${sortedJobs.length - failed.length}건 처리 완료 · ${failed.length}건 실패했습니다. 실패 건은 새로고침 후 다시 시도하세요.`
        : removeAfter
          ? `진행 중 작업 ${sortedJobs.length}건을 모두 취소하고 목록에서 삭제했습니다.`
          : `진행 중 작업 ${sortedJobs.length}건을 모두 취소했습니다.`,
    });
    window.dispatchEvent(new CustomEvent("detail-page-ai-review:jobs-changed"));
    await refresh(true);
  }

  return (
    <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-black text-slate-950">진행 중 작업 제어</h2>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-700">
              {sortedJobs.length}건
            </span>
          </div>
          <p className="mt-1 text-xs font-bold leading-5 text-slate-500">
            현재 실행 중인 상세페이지 작업만 중단합니다. 이미 상품상세에 도킹된 정상 이미지와 HTML은 유지됩니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || sortedJobs.length === 0}
            onClick={() => void cancelAll(false)}
            className="rounded-lg border border-amber-300 bg-white px-3.5 py-2 text-sm font-black text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            진행 중 전체 취소
          </button>
          <button
            type="button"
            disabled={busy || sortedJobs.length === 0}
            onClick={() => void cancelAll(true)}
            className="rounded-lg border border-rose-300 bg-rose-50 px-3.5 py-2 text-sm font-black text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            전체 취소 후 삭제
          </button>
        </div>
      </div>

      {result ? (
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-sm font-bold ${
            result.tone === "error"
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {result.message}
        </div>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm font-bold text-slate-400">진행 중 작업을 확인하고 있습니다.</p>
      ) : sortedJobs.length ? (
        <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {sortedJobs.map((job) => {
            const itemBusy = busyIds.includes(job.jobId);
            return (
              <div
                key={job.jobId}
                className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-900">
                    {detailPageJobName(job)}
                  </p>
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    {detailPageStageLabel(job)} · {Math.max(0, Math.min(100, Math.round(Number(job.progress) || 0)))}% · 시도 {job.attempt || 1}회
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={itemBusy || busyIds.some((id) => id !== job.jobId)}
                    onClick={() => void cancelJob(job, false)}
                    className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-black text-amber-700 hover:bg-amber-50 disabled:cursor-wait disabled:opacity-40"
                  >
                    {itemBusy ? "처리 중…" : "작업 취소"}
                  </button>
                  <button
                    type="button"
                    disabled={itemBusy || busyIds.some((id) => id !== job.jobId)}
                    onClick={() => void cancelJob(job, true)}
                    className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-black text-white hover:bg-rose-700 disabled:cursor-wait disabled:opacity-40"
                  >
                    {itemBusy ? "처리 중…" : "취소 후 삭제"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm font-bold text-slate-500">
          현재 진행 중인 상세페이지 작업이 없습니다.
        </p>
      )}
    </section>
  );
}

async function cancelAndMaybeDelete(
  job: DetailPageReviewJob,
  removeAfter: boolean,
) {
  const cancelResponse = await fetch(
    `${JOBS_API}/${encodeURIComponent(job.jobId)}`,
    {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "cancel" }),
    },
  );
  const cancelBody = (await cancelResponse.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
  };
  if (!cancelResponse.ok || cancelBody.ok !== true) {
    throw new Error(cancelBody.message || "상세페이지 작업 취소에 실패했습니다.");
  }
  if (!removeAfter) return;

  const deleteResponse = await fetch(
    `${JOBS_API}/${encodeURIComponent(job.jobId)}/review-delete`,
    {
      method: "DELETE",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );
  const deleteBody = (await deleteResponse.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
  };
  if (!deleteResponse.ok || deleteBody.ok !== true) {
    throw new Error(
      deleteBody.message ||
        "작업은 취소됐지만 AI 작업검수 목록에서 삭제하지 못했습니다.",
    );
  }
}
