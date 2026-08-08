"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  detailPageJobName,
  detailPageReviewAssets,
  detailPageReviewBucket,
  type DetailPageReviewJob,
} from "@/lib/detailPageAiReview";

const JOBS_API = "/api/product-launch-tracker/detail-page-jobs";

const DEFAULT_MESSAGE =
  "대표·부가 이미지와 최종 상세페이지 이미지를 ZIP 한 개로 다운로드합니다. v3와 Evidence Compiler 결과 모두 지원합니다.";

type StatusState =
  | { tone: "neutral"; message: string }
  | { tone: "success" | "error"; message: string };

function hasFullDownloadAssets(job: DetailPageReviewJob) {
  const assets = detailPageReviewAssets(job);
  return assets.representatives.length > 0 && assets.detail.length > 0;
}

export function DetailPageRepresentativeDownloadControl() {
  const [jobs, setJobs] = useState<DetailPageReviewJob[]>([]);
  const [jobId, setJobId] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusState>({
    tone: "neutral",
    message: DEFAULT_MESSAGE,
  });

  const refresh = useCallback(async () => {
    setLoading(true);
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
        throw new Error(body.message || "다운로드 가능한 상세페이지 작업을 불러오지 못했습니다.");
      }
      setJobs(body.jobs);
      setJobId((current) => {
        const candidates = body.jobs!.filter(hasFullDownloadAssets);
        if (current && candidates.some((job) => job.jobId === current)) return current;
        return (
          candidates.find((job) => detailPageReviewBucket(job) === "passed")?.jobId ||
          candidates[0]?.jobId ||
          ""
        );
      });
      setStatus((current) =>
        current.tone === "error"
          ? { tone: "neutral", message: DEFAULT_MESSAGE }
          : current,
      );
    } catch (error) {
      setStatus({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "다운로드 가능한 상세페이지 작업을 불러오지 못했습니다.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const candidates = useMemo(
    () => jobs.filter(hasFullDownloadAssets),
    [jobs],
  );
  const selected = candidates.find((job) => job.jobId === jobId) || null;
  const selectedAssets = selected ? detailPageReviewAssets(selected) : null;
  const representativeCount = selectedAssets?.representatives.length ?? 0;
  const totalImageCount = representativeCount + (selectedAssets?.detail.length ? 1 : 0);
  const downloadHref = selected
    ? `${JOBS_API}/${encodeURIComponent(selected.jobId)}/representative-images`
    : "";

  const toneClass =
    status.tone === "error"
      ? "bg-red-50 text-red-700"
      : status.tone === "success"
        ? "bg-emerald-50 text-emerald-700"
        : "bg-slate-50 text-slate-600";

  return (
    <section className="mb-5 rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-black text-slate-950">
              대표 부가 상세페이지 전체 ZIP 다운로드
            </h2>
            <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-black text-emerald-700">
              전체 이미지 ZIP
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">
            작업에 실제 저장된 대표·부가 이미지를 01_main, 02_sub_1… 순서로 담고, 마지막에 최종 상세페이지 이미지를 detail_page 파일로 함께 압축합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
        >
          목록 새로고침
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-[280px] flex-1 text-xs font-bold text-slate-700">
          다운로드 작업
          <select
            value={jobId}
            onChange={(event) => setJobId(event.target.value)}
            disabled={loading || candidates.length === 0}
            className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900"
          >
            {candidates.length === 0 ? (
              <option value="">대표·부가·최종 상세페이지 이미지가 모두 저장된 작업이 없습니다.</option>
            ) : null}
            {candidates.map((job) => {
              const assets = detailPageReviewAssets(job);
              const count = assets.representatives.length;
              return (
                <option key={job.jobId} value={job.jobId}>
                  {detailPageJobName(job)} · 대표·부가 {count}장 + 상세페이지 · {job.jobId.slice(0, 8)}
                </option>
              );
            })}
          </select>
        </label>

        {selected ? (
          <a
            href={downloadHref}
            onClick={() =>
              setStatus({
                tone: "success",
                message: `${detailPageJobName(selected)} · 대표·부가 ${representativeCount}장 + 최종 상세페이지 이미지까지 총 ${totalImageCount}장 ZIP 다운로드를 요청했습니다.`,
              })
            }
            className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800"
          >
            대표 부가 상세페이지 전체 ZIP 다운로드
          </a>
        ) : (
          <span className="rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-black text-slate-500">
            다운로드할 전체 이미지 없음
          </span>
        )}
      </div>

      <div className={`mt-3 rounded-xl px-3 py-2 text-xs font-bold ${toneClass}`} role="status">
        {status.message}
      </div>
    </section>
  );
}
