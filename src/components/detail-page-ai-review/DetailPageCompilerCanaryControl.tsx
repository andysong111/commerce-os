"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  detailPageJobName,
  detailPageReviewBucket,
  type DetailPageReviewJob,
} from "@/lib/detailPageAiReview";

const JOBS_API = "/api/product-launch-tracker/detail-page-jobs";

type State =
  | { tone: "neutral"; message: string }
  | { tone: "progress" | "success" | "error"; message: string };

export function DetailPageCompilerCanaryControl() {
  const [jobs, setJobs] = useState<DetailPageReviewJob[]>([]);
  const [jobId, setJobId] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [state, setState] = useState<State>({
    tone: "neutral",
    message:
      "기존 완료·실패 작업의 1688 원본과 상품분석을 재사용해 새 Compiler만 1건 카나리 실행합니다.",
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
        throw new Error(body.message || "카나리 후보 작업을 불러오지 못했습니다.");
      }
      setJobs(body.jobs);
      setJobId((current) =>
        current && body.jobs?.some((job) => job.jobId === current)
          ? current
          : body.jobs?.find((job) => ["needs_review", "passed"].includes(detailPageReviewBucket(job)))?.jobId ||
            body.jobs?.[0]?.jobId ||
            "",
      );
    } catch (error) {
      setState({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "카나리 후보 작업을 불러오지 못했습니다.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const candidates = useMemo(
    () =>
      jobs.filter((job) =>
        ["needs_review", "passed"].includes(detailPageReviewBucket(job)),
      ),
    [jobs],
  );

  const selected = candidates.find((job) => job.jobId === jobId);

  const run = async () => {
    if (!selected || running) return;
    const name = detailPageJobName(selected);
    if (
      !window.confirm(
        `${name} 작업을 Evidence Compiler v1 카나리로 다시 실행할까요?\n\n기존 상품출시진행관리 이미지 URL/HTML은 새 결과가 최종 PASS하기 전까지 유지됩니다.`,
      )
    ) {
      return;
    }
    setRunning(true);
    setState({
      tone: "progress",
      message: `${name} · 기존 1688 원본을 재사용해 Compiler 카나리를 시작하고 있습니다.`,
    });
    try {
      const response = await fetch(`${JOBS_API}/${encodeURIComponent(selected.jobId)}/start`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ action: "compiler_v1_canary" }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        accepted?: boolean;
        engineProfile?: string;
        message?: string;
      };
      if (!response.ok || body.ok !== true || body.accepted !== true) {
        throw new Error(body.message || "Evidence Compiler 카나리를 시작하지 못했습니다.");
      }
      setState({
        tone: "success",
        message: `${name} · ${body.engineProfile || "ops-evidence-compiler-v1"} 카나리 시작 완료. 아래 작업 목록에서 진행 상태를 확인하세요.`,
      });
      window.setTimeout(() => void refresh(), 1_000);
    } catch (error) {
      setState({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Evidence Compiler 카나리를 시작하지 못했습니다.",
      });
    } finally {
      setRunning(false);
    }
  };

  const toneClass =
    state.tone === "error"
      ? "bg-red-50 text-red-700"
      : state.tone === "success"
        ? "bg-emerald-50 text-emerald-700"
        : state.tone === "progress"
          ? "bg-blue-50 text-blue-700"
          : "bg-slate-50 text-slate-600";

  return (
    <section className="mb-5 rounded-2xl border border-violet-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-black text-slate-950">Evidence Compiler v1 · 1건 카나리</h2>
            <span className="rounded-full bg-violet-100 px-2 py-1 text-[11px] font-black text-violet-700">
              기본 엔진 미변경
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">
            완료·검수필요 작업의 기존 1688 원본과 Product Intelligence를 재사용합니다. AI가 상품 본체를 다시 그리지 않고 source-pixel 방식으로 조립하며, 최종 JPG 픽셀 검수 PASS일 때만 상품출시진행관리에 도킹합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || running}
          className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
        >
          후보 새로고침
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-[280px] flex-1 text-xs font-bold text-slate-700">
          카나리 작업
          <select
            value={jobId}
            onChange={(event) => setJobId(event.target.value)}
            disabled={loading || running || candidates.length === 0}
            className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900"
          >
            {candidates.length === 0 ? (
              <option value="">카나리 가능한 완료·검수필요 작업이 없습니다.</option>
            ) : null}
            {candidates.map((job) => (
              <option key={job.jobId} value={job.jobId}>
                {detailPageJobName(job)} · {detailPageReviewBucket(job) === "passed" ? "완료" : "검수필요"} · {job.jobId.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!selected || running || loading}
          className="rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? "카나리 시작 중…" : "선택 1건 Compiler 카나리"}
        </button>
      </div>

      <div className={`mt-3 rounded-xl px-3 py-2 text-xs font-bold ${toneClass}`} role="status">
        {state.message}
      </div>
    </section>
  );
}
