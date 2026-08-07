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

type Notice = { tone: "success" | "error"; message: string } | null;

export function DetailPageActiveJobControlsV2() {
  const [jobs, setJobs] = useState<DetailPageReviewJob[]>([]);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(JOBS_API, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        jobs?: DetailPageReviewJob[];
      };
      if (response.ok && body.ok === true && Array.isArray(body.jobs)) {
        setJobs(body.jobs.filter(isActiveDetailPageJob));
      }
    } catch {
      // Existing review workspace still shows the durable job list.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const activeJobs = useMemo(
    () => [...jobs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [jobs],
  );
  const busy = busyIds.length > 0;

  async function runOne(job: DetailPageReviewJob, removeAfter: boolean) {
    if (busyIds.includes(job.jobId)) return;
    if (!window.confirm(confirmText(job, removeAfter))) return;
    setBusyIds((current) => [...current, job.jobId]);
    setNotice(null);
    try {
      await cancelAndMaybeDelete(job.jobId, removeAfter);
      setJobs((current) => current.filter((item) => item.jobId !== job.jobId));
      setNotice({
        tone: "success",
        message: removeAfter
          ? `"${detailPageJobName(job)}" 작업을 취소하고 삭제했습니다.`
          : `"${detailPageJobName(job)}" 작업을 취소했습니다.`,
      });
      await refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "작업을 처리하지 못했습니다.",
      });
    } finally {
      setBusyIds((current) => current.filter((id) => id !== job.jobId));
    }
  }

  async function runAll(removeAfter: boolean) {
    if (busy || !activeJobs.length) return;
    const label = removeAfter ? "모두 취소하고 삭제" : "모두 취소";
    if (
      !window.confirm(
        `현재 진행 중인 상세페이지 작업 ${activeJobs.length}건을 ${label}할까요?\n이미 상품상세에 도킹된 기존 대표·부가·상세페이지 결과는 유지됩니다.`,
      )
    ) return;

    setBusyIds(activeJobs.map((job) => job.jobId));
    setNotice(null);
    const settled = await Promise.allSettled(
      activeJobs.map((job) => cancelAndMaybeDelete(job.jobId, removeAfter)),
    );
    const failed = settled.filter((item) => item.status === "rejected").length;
    setBusyIds([]);
    setNotice({
      tone: failed ? "error" : "success",
      message: failed
        ? `${activeJobs.length - failed}건 처리 완료 · ${failed}건 실패했습니다.`
        : removeAfter
          ? `진행 중 작업 ${activeJobs.length}건을 모두 취소하고 삭제했습니다.`
          : `진행 중 작업 ${activeJobs.length}건을 모두 취소했습니다.`,
    });
    await refresh();
  }

  return (
    <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-black text-slate-950">진행 중 작업 제어</h2>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-700">
              {activeJobs.length}건
            </span>
          </div>
          <p className="mt-1 text-xs font-bold leading-5 text-slate-500">
            현재 실행 중인 job만 중단합니다. 기존 상품상세 이미지와 HTML은 유지됩니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || activeJobs.length === 0}
            onClick={() => void runAll(false)}
            className="rounded-lg border border-amber-300 px-3.5 py-2 text-sm font-black text-amber-700 disabled:opacity-40"
          >
            진행 중 전체 취소
          </button>
          <button
            type="button"
            disabled={busy || activeJobs.length === 0}
            onClick={() => void runAll(true)}
            className="rounded-lg bg-rose-600 px-3.5 py-2 text-sm font-black text-white disabled:opacity-40"
          >
            전체 취소 후 삭제
          </button>
        </div>
      </div>

      {notice ? (
        <p className={`mt-3 rounded-lg px-3 py-2 text-sm font-bold ${notice.tone === "error" ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>
          {notice.message}
        </p>
      ) : null}

      {activeJobs.length ? (
        <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {activeJobs.map((job) => {
            const itemBusy = busyIds.includes(job.jobId);
            return (
              <div key={job.jobId} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-900">{detailPageJobName(job)}</p>
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    {detailPageStageLabel(job)} · {Math.round(Number(job.progress) || 0)}% · 시도 {job.attempt || 1}회
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy && !itemBusy}
                    onClick={() => void runOne(job, false)}
                    className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-black text-amber-700 disabled:opacity-40"
                  >
                    {itemBusy ? "처리 중…" : "작업 취소"}
                  </button>
                  <button
                    type="button"
                    disabled={busy && !itemBusy}
                    onClick={() => void runOne(job, true)}
                    className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40"
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

function confirmText(job: DetailPageReviewJob, removeAfter: boolean) {
  return removeAfter
    ? `"${detailPageJobName(job)}" 작업을 취소하고 삭제할까요?\n기존 상품상세 결과는 유지됩니다.`
    : `"${detailPageJobName(job)}" 작업을 취소할까요?\n기존 상품상세 결과는 유지됩니다.`;
}

async function cancelAndMaybeDelete(jobId: string, removeAfter: boolean) {
  const cancelResponse = await fetch(`${JOBS_API}/${encodeURIComponent(jobId)}/review-cancel`, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const cancelBody = (await cancelResponse.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
  };
  if (!cancelResponse.ok || cancelBody.ok !== true) {
    throw new Error(cancelBody.message || "상세페이지 작업 취소에 실패했습니다.");
  }
  if (!removeAfter) return;

  const deleteResponse = await fetch(`${JOBS_API}/${encodeURIComponent(jobId)}/review-delete`, {
    method: "DELETE",
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const deleteBody = (await deleteResponse.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
  };
  if (!deleteResponse.ok || deleteBody.ok !== true) {
    throw new Error(deleteBody.message || "작업은 취소됐지만 삭제하지 못했습니다.");
  }
}
