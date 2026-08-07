"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  detailPageJobName,
  detailPageReviewBucket,
  detailPageStageLabel,
  type DetailPageReviewJob,
} from "@/lib/detailPageAiReview";

const JOBS_API = "/api/product-launch-tracker/detail-page-jobs";
const POLL_MS = 2_500;

type ManagedBucket = "needs_review" | "passed";
type Notice = { tone: "success" | "error"; message: string } | null;

export function DetailPageTerminalJobControls() {
  const [jobs, setJobs] = useState<DetailPageReviewJob[]>([]);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [open, setOpen] = useState(false);

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
        setJobs(
          body.jobs.filter((job) => {
            const bucket = detailPageReviewBucket(job);
            return bucket === "needs_review" || bucket === "passed";
          }),
        );
      }
    } catch {
      // The main review workspace still shows the durable list and its load errors.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const groups = useMemo(() => {
    const needsReview = jobs.filter(
      (job) => detailPageReviewBucket(job) === "needs_review",
    );
    const passed = jobs.filter((job) => detailPageReviewBucket(job) === "passed");
    return { needsReview, passed };
  }, [jobs]);

  const busy = busyIds.length > 0;

  async function deleteOne(job: DetailPageReviewJob) {
    if (busyIds.includes(job.jobId)) return;
    const bucket = detailPageReviewBucket(job);
    if (bucket !== "needs_review" && bucket !== "passed") return;
    if (!window.confirm(deleteConfirmText(job, bucket))) return;

    setBusyIds((current) => [...current, job.jobId]);
    setNotice(null);
    try {
      await deleteJob(job.jobId);
      setJobs((current) => current.filter((item) => item.jobId !== job.jobId));
      setNotice({
        tone: "success",
        message: `"${detailPageJobName(job)}" 작업 기록을 삭제했습니다. 상품상세 이미지와 HTML은 유지됩니다.`,
      });
      window.dispatchEvent(new CustomEvent("detail-page-ai-review:jobs-changed"));
      await refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "작업 기록을 삭제하지 못했습니다.",
      });
    } finally {
      setBusyIds((current) => current.filter((id) => id !== job.jobId));
    }
  }

  async function deleteGroup(bucket: ManagedBucket) {
    if (busy) return;
    const targets = bucket === "needs_review" ? groups.needsReview : groups.passed;
    if (!targets.length) return;
    const label = bucket === "needs_review" ? "검수 필요" : "완료";
    const warning =
      bucket === "needs_review"
        ? "삭제하면 이 작업의 실패 원인·체크포인트를 AI 검수 화면에서 다시 복구할 수 없습니다."
        : "삭제하면 이 완료 작업의 체크포인트를 이용한 부분 재생성·재검수·최종 재조립을 더 이상 할 수 없습니다.";
    if (
      !window.confirm(
        `${label} 작업 ${targets.length}건의 작업 원장을 모두 삭제할까요?\n${warning}\n이미 상품상세에 도킹된 대표·부가·상세페이지 URL/HTML과 저장 이미지 파일은 유지됩니다.`,
      )
    ) return;

    setBusyIds(targets.map((job) => job.jobId));
    setNotice(null);
    const settled = await Promise.allSettled(targets.map((job) => deleteJob(job.jobId)));
    const failed = settled.filter((item) => item.status === "rejected").length;
    setBusyIds([]);
    setNotice({
      tone: failed ? "error" : "success",
      message: failed
        ? `${targets.length - failed}건 삭제 완료 · ${failed}건 실패했습니다.`
        : `${label} 작업 ${targets.length}건을 모두 삭제했습니다. 상품상세 결과는 유지됩니다.`,
    });
    window.dispatchEvent(new CustomEvent("detail-page-ai-review:jobs-changed"));
    await refresh();
  }

  return (
    <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-black text-slate-950">검수 필요·완료 기록 관리</h2>
            <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-black text-rose-700">
              검수 필요 {groups.needsReview.length}
            </span>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700">
              완료 {groups.passed.length}
            </span>
          </div>
          <p className="mt-1 text-xs font-bold leading-5 text-slate-500">
            작업 원장만 삭제합니다. 상품상세에 이미 연결된 대표·부가·상세페이지 URL/HTML과 저장 이미지 파일은 유지됩니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || groups.needsReview.length === 0}
            onClick={() => void deleteGroup("needs_review")}
            className="rounded-lg border border-rose-300 bg-white px-3.5 py-2 text-sm font-black text-rose-700 hover:bg-rose-50 disabled:opacity-40"
          >
            검수 필요 전체 삭제
          </button>
          <button
            type="button"
            disabled={busy || groups.passed.length === 0}
            onClick={() => void deleteGroup("passed")}
            className="rounded-lg border border-emerald-300 bg-white px-3.5 py-2 text-sm font-black text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
          >
            완료 전체 삭제
          </button>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-black text-slate-700 hover:bg-slate-50"
          >
            {open ? "개별 목록 접기" : "개별 삭제 목록"}
          </button>
        </div>
      </div>

      {notice ? (
        <p className={`mt-3 rounded-lg px-3 py-2 text-sm font-bold ${notice.tone === "error" ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>
          {notice.message}
        </p>
      ) : null}

      {open ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <JobGroup
            title="검수 필요"
            jobs={groups.needsReview}
            busyIds={busyIds}
            onDelete={deleteOne}
            empty="삭제할 검수 필요 작업이 없습니다."
            tone="rose"
          />
          <JobGroup
            title="완료"
            jobs={groups.passed}
            busyIds={busyIds}
            onDelete={deleteOne}
            empty="삭제할 완료 작업이 없습니다."
            tone="emerald"
          />
        </div>
      ) : null}
    </section>
  );
}

function JobGroup({
  title,
  jobs,
  busyIds,
  onDelete,
  empty,
  tone,
}: {
  title: string;
  jobs: DetailPageReviewJob[];
  busyIds: string[];
  onDelete: (job: DetailPageReviewJob) => Promise<void>;
  empty: string;
  tone: "rose" | "emerald";
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="bg-slate-50 px-4 py-3 text-sm font-black text-slate-800">
        {title} {jobs.length}건
      </div>
      {jobs.length ? (
        <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
          {jobs.map((job) => {
            const itemBusy = busyIds.includes(job.jobId);
            return (
              <div key={job.jobId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-900">
                    {detailPageJobName(job)}
                  </p>
                  <p className="mt-1 truncate text-xs font-bold text-slate-500">
                    {detailPageStageLabel(job)} · 시도 {job.attempt || 1}회
                  </p>
                </div>
                <button
                  type="button"
                  disabled={itemBusy || busyIds.some((id) => id !== job.jobId)}
                  onClick={() => void onDelete(job)}
                  className={`shrink-0 rounded-lg px-3 py-2 text-xs font-black disabled:opacity-40 ${
                    tone === "rose"
                      ? "bg-rose-600 text-white hover:bg-rose-700"
                      : "bg-emerald-700 text-white hover:bg-emerald-800"
                  }`}
                >
                  {itemBusy ? "삭제 중…" : "삭제"}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="px-4 py-5 text-sm font-bold text-slate-500">{empty}</p>
      )}
    </div>
  );
}

function deleteConfirmText(job: DetailPageReviewJob, bucket: ManagedBucket) {
  const warning =
    bucket === "needs_review"
      ? "이 작업의 실패 원인과 재생성 체크포인트는 삭제됩니다."
      : "이 작업의 재검수·부분 재생성·최종 재조립 체크포인트는 삭제됩니다.";
  return `"${detailPageJobName(job)}" 작업 원장을 삭제할까요?\n${warning}\n상품상세의 기존 이미지 URL/HTML과 저장 이미지 파일은 유지됩니다.`;
}

async function deleteJob(jobId: string) {
  const response = await fetch(
    `${JOBS_API}/${encodeURIComponent(jobId)}/review-delete`,
    {
      method: "DELETE",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
  };
  if (!response.ok || body.ok !== true) {
    throw new Error(body.message || "상세페이지 작업 기록을 삭제하지 못했습니다.");
  }
}
