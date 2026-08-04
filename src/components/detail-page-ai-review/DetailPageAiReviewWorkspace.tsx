"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canReassembleCompletedDetailPageJob,
  canRevalidateCompletedDetailPageJob,
  canResumeDetailPageCheckpoint,
  detailPageCheckpointId,
  detailPageFailureCode,
  detailPageJobName,
  detailPageProblemReason,
  detailPageReviewAssets,
  detailPageReviewBucket,
  detailPageRoleLabel,
  detailPageStageLabel,
  detailPageStandardDiagnostics,
  findDetailPageResumeCandidate,
  hasFullAssetDetailPageAssessment,
  isActiveDetailPageJob,
  isRecoverableServerFinalAssemblyJob,
  type DetailPageReviewAsset,
  type DetailPageReviewBucket,
  type DetailPageReviewJob,
  type DetailPageStandardPanelDiagnostic,
} from "@/lib/detailPageAiReview";

const JOBS_API = "/api/product-launch-tracker/detail-page-jobs";
const WORK_ASSISTANT_SOURCE = "commerce-os-work-assistant";
const DOCK_EVENT_SOURCE = "commerce-os-detail-page-dock";
const REVIEW_EVENT_SOURCE = "commerce-os-detail-page-ai-review";
const POLL_MS = 2_500;

type Filter = "needs_review" | "active" | "passed" | "all";
type ActionState = { tone: "progress" | "success" | "error"; message: string } | null;

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "needs_review", label: "검수 필요" },
  { id: "active", label: "진행 중" },
  { id: "passed", label: "완료" },
  { id: "all", label: "전체" },
];

export function DetailPageAiReviewWorkspace() {
  const workerRef = useRef<HTMLIFrameElement>(null);
  const [jobs, setJobs] = useState<DetailPageReviewJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [filter, setFilter] = useState<Filter>("needs_review");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [workerReady, setWorkerReady] = useState(false);
  const [actionJobId, setActionJobId] = useState("");
  const [actionState, setActionState] = useState<ActionState>(null);
  const [preview, setPreview] = useState<DetailPageReviewAsset | null>(null);

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
        throw new Error(body.message || "상세페이지 작업을 불러오지 못했습니다.");
      }
      setJobs(body.jobs);
      setLoadError("");
      setSelectedJobId((current) => {
        if (current && body.jobs?.some((job) => job.jobId === current)) return current;
        return (
          body.jobs?.find((job) => detailPageReviewBucket(job) === "needs_review")?.jobId ||
          body.jobs?.[0]?.jobId ||
          ""
        );
      });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "상세페이지 작업을 불러오지 못했습니다.");
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

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== workerRef.current?.contentWindow) return;
      const payload = event.data;
      if (payload?.source === DOCK_EVENT_SOURCE && payload?.type === "detail-page-worker-ready") {
        setWorkerReady(true);
        return;
      }
      if (payload?.source === DOCK_EVENT_SOURCE && payload?.type === "detail-page-job-created") {
        if (isReviewJob(payload.job)) {
          setJobs((current) => [
            payload.job,
            ...current.filter((job) => job.jobId !== payload.job.jobId),
          ]);
          setSelectedJobId(payload.job.jobId);
        }
        void refresh(true);
      }
      if (payload?.source === REVIEW_EVENT_SOURCE && payload?.type === "regeneration-status") {
        setActionState({
          tone: payload.tone === "error" ? "error" : payload.tone === "success" ? "success" : "progress",
          message: String(payload.message || "재생성 요청을 처리하고 있습니다."),
        });
        if (payload.tone !== "progress") setActionJobId("");
        if (isReviewJob(payload.job)) setSelectedJobId(payload.job.jobId);
        void refresh(true);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [refresh]);

  useEffect(() => {
    if (workerReady) return;
    const ping = () => {
      workerRef.current?.contentWindow?.postMessage(
        {
          source: WORK_ASSISTANT_SOURCE,
          type: "detail-page-worker-ping",
        },
        window.location.origin,
      );
    };
    const initial = window.setTimeout(ping, 0);
    const interval = window.setInterval(ping, 1_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [workerReady]);

  const counts = useMemo(() => countJobs(jobs), [jobs]);
  const visibleJobs = useMemo(() => {
    const normalized = query.replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
    return jobs.filter((job) => {
      const bucket = detailPageReviewBucket(job);
      if (filter !== "all" && bucket !== filter) return false;
      if (!normalized) return true;
      const haystack = `${detailPageJobName(job)} ${job.itemId} ${job.message} ${job.error}`
        .replace(/\s+/g, "")
        .toLocaleLowerCase("ko-KR");
      return haystack.includes(normalized);
    });
  }, [filter, jobs, query]);
  const selected = visibleJobs.find((job) => job.jobId === selectedJobId) || visibleJobs[0] || null;
  const resumeTarget = selected
    ? findDetailPageResumeCandidate(jobs, selected)
    : null;

  async function requestRegeneration(job: DetailPageReviewJob, mode: "resume" | "full") {
    if (actionJobId || (mode === "full" && !workerReady)) return;
    const resumable = canResumeDetailPageCheckpoint(job);
    const partial = mode === "resume" && resumable;
    const reviewAssets = detailPageReviewAssets(job);
    const problemCount = [
      ...reviewAssets.representatives,
      ...reviewAssets.panels,
    ].filter((asset) => asset.problem).length;
    const standardDiagnostics = detailPageStandardDiagnostics(job);
    const problemCountConfirmed =
      hasFullAssetDetailPageAssessment(job) || standardDiagnostics.length > 0;
    const confirmed = window.confirm(
      partial
        ? standardDiagnostics.length
          ? `\"${detailPageJobName(job)}\"의 정상 자산은 모두 유지하고, Standard-v2에서 차단된 상세 섹션 ${standardDiagnostics.length}장만 다시 생성합니다.\n재생성 후 전체 상품 일치 검수와 Standard-v2를 다시 실행하며 AI 비용이 일부 발생할 수 있습니다. 계속할까요?`
          : problemCountConfirmed && problemCount
          ? `\"${detailPageJobName(job)}\"의 정상 자산은 모두 유지하고, 전체 결과 검수에서 지목된 문제 이미지 ${problemCount}장만 다시 생성합니다.\nAI 검수·이미지 비용이 일부 발생할 수 있습니다. 계속할까요?`
          : `\"${detailPageJobName(job)}\"의 기존 생성 결과 전체를 1688 원본과 먼저 재검수하고, 새 검수에서 지목된 문제 이미지만 다시 생성합니다.\n정상 자산은 유지되며 AI 검수·이미지 비용이 일부 발생할 수 있습니다. 계속할까요?`
        : `\"${detailPageJobName(job)}\"을 1688 수집부터 전체 다시 생성합니다.\n기존 결과는 보존되지만 AI 생성 비용과 처리시간이 다시 발생합니다. 계속할까요?`,
    );
    if (!confirmed) return;
    const requestId = crypto.randomUUID();
    setActionJobId(job.jobId);
    setActionState({
      tone: "progress",
      message: partial
        ? standardDiagnostics.length
          ? `기존 체크포인트에서 Standard-v2 차단 상세 섹션 ${standardDiagnostics.length}장만 재생성합니다.`
          : problemCountConfirmed && problemCount
          ? `기존 체크포인트에서 문제 이미지 ${problemCount}장만 재생성합니다.`
          : "기존 결과 전체를 원본과 재검수한 뒤 지목된 문제 이미지만 재생성합니다."
        : "전체 재생성 연결과 1688 수집기를 확인하고 있습니다.",
    });
    if (partial) {
      try {
        const resumeResponse = await fetch(
          `${JOBS_API}/${encodeURIComponent(job.jobId)}`,
          {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ action: "resume_checkpointed_generation" }),
          },
        );
        const resumeBody = (await resumeResponse.json().catch(() => ({}))) as {
          ok?: boolean;
          job?: DetailPageReviewJob;
          message?: string;
        };
        if (!resumeResponse.ok || resumeBody.ok !== true || !isReviewJob(resumeBody.job)) {
          throw new Error(
            resumeBody.message ||
              "기존 상세페이지 체크포인트를 재개하지 못했습니다.",
          );
        }

        setJobs((current) => [
          resumeBody.job!,
          ...current.filter((candidate) => candidate.jobId !== resumeBody.job!.jobId),
        ]);
        setFilter("active");
        setSelectedJobId(resumeBody.job.jobId);

        const startResponse = await fetch(
          `${JOBS_API}/${encodeURIComponent(job.jobId)}/start`,
          {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
            headers: { Accept: "application/json" },
          },
        );
        const startBody = (await startResponse.json().catch(() => ({}))) as {
          ok?: boolean;
          accepted?: boolean;
          message?: string;
        };
        if (!startResponse.ok || startBody.ok !== true) {
          throw new Error(
            startBody.message ||
              "체크포인트는 복구됐지만 Studio 서버 작업을 시작하지 못했습니다.",
          );
        }

        setActionState({
          tone: "success",
          message:
            "1688 재수집 없이 기존 체크포인트에서 전체 재검수와 문제 이미지 복구를 시작했습니다.",
        });
        await refresh(true);
      } catch (error) {
        setActionState({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "체크포인트 부분 복구를 시작하지 못했습니다.",
        });
        await refresh(true);
      } finally {
        setActionJobId("");
      }
      return;
    }

    workerRef.current?.contentWindow?.postMessage(
      {
        source: WORK_ASSISTANT_SOURCE,
        type: "retry-detail-page-job",
        itemId: job.itemId,
        jobId: job.jobId,
        mode,
        requestId,
      },
      window.location.origin,
    );
  }

  async function revalidateCompletedGeneration(job: DetailPageReviewJob) {
    if (actionJobId || !canRevalidateCompletedDetailPageJob(job)) return;
    if (
      !window.confirm(
        `\"${detailPageJobName(job)}\"의 저장된 1688 원본과 기존 생성 자산을 유지한 채 모델명·판매옵션 기준으로 다시 검수합니다.\n새 검수에서 지목된 문제 이미지만 재생성하며 AI 검수·이미지 비용이 일부 발생할 수 있습니다. 계속할까요?`,
      )
    ) {
      return;
    }
    setActionJobId(job.jobId);
    setActionState({
      tone: "progress",
      message:
        "저장된 1688 원본과 생성 자산을 모델명·판매옵션 기준으로 다시 검수하고 있습니다.",
    });
    try {
      const response = await fetch(
        `${JOBS_API}/${encodeURIComponent(job.jobId)}`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "revalidate_completed_generation" }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        job?: DetailPageReviewJob;
        message?: string;
      };
      if (!response.ok || body.ok !== true || !isReviewJob(body.job)) {
        throw new Error(
          body.message || "완료된 생성 자산을 다시 검수하도록 준비하지 못했습니다.",
        );
      }
      setJobs((current) => [
        body.job!,
        ...current.filter((candidate) => candidate.jobId !== body.job!.jobId),
      ]);
      setFilter("active");
      setSelectedJobId(body.job.jobId);

      const startResponse = await fetch(
        `${JOBS_API}/${encodeURIComponent(job.jobId)}/start`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        },
      );
      const startBody = (await startResponse.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!startResponse.ok || startBody.ok !== true) {
        throw new Error(
          startBody.message ||
            "재검수 체크포인트는 준비됐지만 Studio 서버 작업을 시작하지 못했습니다.",
        );
      }
      setActionState({
        tone: "success",
        message:
          "1688 재수집 없이 전체 자산 재검수와 문제 이미지만 부분 재생성을 시작했습니다.",
      });
      await refresh(true);
    } catch (error) {
      setActionState({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "완료 작업의 부분 재생성을 시작하지 못했습니다.",
      });
      await refresh(true);
    } finally {
      setActionJobId("");
    }
  }

  async function reconnectFinalAssembly(
    job: DetailPageReviewJob,
    reassembleCompleted = false,
  ) {
    const recoverable = isRecoverableServerFinalAssemblyJob(job);
    const completedReassembly =
      reassembleCompleted && canReassembleCompletedDetailPageJob(job);
    if (actionJobId || (!recoverable && !completedReassembly)) return;
    if (
      completedReassembly &&
      !window.confirm(
        `"${detailPageJobName(job)}"의 대표·부가 이미지와 상세 섹션은 그대로 유지하고 최종 14,000px JPEG만 최신 템플릿으로 다시 조립합니다.\n1688 재수집과 AI 재생성 비용은 발생하지 않습니다. 계속할까요?`,
      )
    ) {
      return;
    }
    setActionJobId(job.jobId);
    setActionState({
      tone: "progress",
      message: completedReassembly
        ? "저장된 검수 통과 자산으로 최종 14,000px JPEG만 다시 조립하고 있습니다."
        : "1688 재수집·AI 재생성 없이 저장된 검수 통과 자산으로 서버 최종 조립을 시작하고 있습니다.",
    });
    try {
      const response = await fetch(
        `${JOBS_API}/${encodeURIComponent(job.jobId)}/start`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: completedReassembly
            ? JSON.stringify({ action: "reassemble_final_only" })
            : undefined,
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        accepted?: boolean;
        message?: string;
      };
      if (!response.ok || body.ok !== true) {
        throw new Error(
          body.message || "서버 최종 조립을 시작하지 못했습니다.",
        );
      }
      setActionState({
        tone: "success",
        message: completedReassembly
          ? "최종 상세페이지만 다시 조립하기 시작했습니다. AI 이미지와 저장된 1688 원본은 그대로 유지됩니다."
          : "서버 최종 조립을 시작했습니다. 화면을 닫아도 계속되며 저장된 1688 원본은 다시 다운로드하지 않습니다.",
      });
      void refresh(true);
    } catch (error) {
      setActionState({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "서버 최종 조립을 시작하지 못했습니다.",
      });
      await refresh(true);
    } finally {
      setActionJobId("");
    }
  }

  return (
    <>
      <iframe
        ref={workerRef}
        title="상세페이지 AI 검수 재생성 실행기"
        src="/product-launch-tracker-app/index.html?detail_page_mode=worker"
        aria-hidden="true"
        tabIndex={-1}
        onLoad={() => {
          workerRef.current?.contentWindow?.postMessage(
            {
              source: WORK_ASSISTANT_SOURCE,
              type: "detail-page-worker-ping",
            },
            window.location.origin,
          );
        }}
        className="pointer-events-none fixed -left-[2400px] top-0 z-[-1] h-[900px] w-[1280px] border-0 opacity-0"
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="검수 필요" value={counts.needs_review} tone="red" detail="실패·문제 이미지 확인" />
        <SummaryCard label="진행 중" value={counts.active} tone="blue" detail="수집·생성·최종 조립" />
        <SummaryCard label="검수 통과" value={counts.passed} tone="green" detail="상품출시진행관리 도킹 완료" />
        <SummaryCard label="최근 작업" value={jobs.length} tone="slate" detail="최근 50개 작업 기준" />
      </section>

      {actionState ? (
        <div
          role="status"
          className={`mt-4 rounded-xl border px-4 py-3 text-sm font-bold ${
            actionState.tone === "error"
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : actionState.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-blue-200 bg-blue-50 text-blue-800"
          }`}
        >
          {actionState.message}
        </div>
      ) : null}

      <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-4 sm:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="상세페이지 작업 상태 필터">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.id}
                  onClick={() => setFilter(item.id)}
                  className={`rounded-lg px-3.5 py-2 text-sm font-black ${
                    filter === item.id
                      ? "bg-slate-950 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {item.label} {filterCount(item.id, counts, jobs.length)}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="상품명·모델번호 검색"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 xl:w-72"
              />
              <button
                type="button"
                onClick={() => void refresh()}
                className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-50"
              >
                새로고침
              </button>
            </div>
          </div>
        </div>

        {loadError ? (
          <div className="m-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">
            {loadError}
          </div>
        ) : null}

        <div className="grid min-h-[640px] lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="border-b border-slate-200 bg-slate-50 lg:border-b-0 lg:border-r">
            {loading && !jobs.length ? (
              <p className="p-8 text-center text-sm font-bold text-slate-500">작업을 불러오는 중입니다.</p>
            ) : visibleJobs.length ? (
              <div className="max-h-[760px] divide-y divide-slate-200 overflow-y-auto">
                {visibleJobs.map((job) => (
                  <JobListButton
                    key={job.jobId}
                    job={job}
                    selected={selected?.jobId === job.jobId}
                    onClick={() => setSelectedJobId(job.jobId)}
                  />
                ))}
              </div>
            ) : (
              <div className="p-10 text-center">
                <p className="font-black text-slate-700">조건에 맞는 작업이 없습니다.</p>
                <p className="mt-2 text-sm text-slate-500">다른 상태 필터나 검색어를 선택하세요.</p>
              </div>
            )}
          </div>

          <div className="min-w-0 p-4 sm:p-6">
            {selected ? (
              <JobReviewDetail
                job={selected}
                resumeTarget={resumeTarget}
                workerReady={workerReady}
                busy={Boolean(actionJobId)}
                currentBusy={
                  actionJobId === selected.jobId ||
                  actionJobId === resumeTarget?.jobId
                }
                onPreview={setPreview}
                onResume={() => {
                  if (resumeTarget) void requestRegeneration(resumeTarget, "resume");
                }}
                onReconnectFinalizer={() => reconnectFinalAssembly(selected)}
                onReassembleFinal={() =>
                  reconnectFinalAssembly(selected, true)
                }
                onRevalidateCompleted={() =>
                  void revalidateCompletedGeneration(selected)
                }
                onFullRetry={() => void requestRegeneration(selected, "full")}
              />
            ) : (
              <div className="grid min-h-[420px] place-items-center text-center">
                <div>
                  <p className="font-black text-slate-700">검수할 작업을 선택하세요.</p>
                  <p className="mt-2 text-sm text-slate-500">왼쪽 목록에서 상품을 누르면 생성 이미지와 판정 사유가 표시됩니다.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {preview ? <ImagePreview asset={preview} onClose={() => setPreview(null)} /> : null}
    </>
  );
}

function JobListButton({
  job,
  selected,
  onClick,
}: {
  job: DetailPageReviewJob;
  selected: boolean;
  onClick: () => void;
}) {
  const bucket = detailPageReviewBucket(job);
  const presentation = bucketPresentation(bucket);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full p-4 text-left transition-colors ${selected ? "bg-white shadow-[inset_4px_0_0_#2563eb]" : "hover:bg-white"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-black text-slate-950">{detailPageJobName(job)}</p>
          <p className="mt-1 truncate text-xs font-bold text-slate-400">{job.itemId}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${presentation.badge}`}>
          {presentation.label}
        </span>
      </div>
      <p className={`mt-3 line-clamp-2 text-xs font-bold leading-5 ${bucket === "needs_review" ? "text-rose-700" : "text-slate-600"}`}>
        {job.error || job.message || detailPageStageLabel(job)}
      </p>
      <div className="mt-3 flex items-center justify-between text-[11px] font-bold text-slate-400">
        <span>{detailPageStageLabel(job)} · {safeProgress(job.progress)}%</span>
        <span>{formatDate(job.updatedAt)}</span>
      </div>
    </button>
  );
}

function JobReviewDetail({
  job,
  resumeTarget,
  workerReady,
  busy,
  currentBusy,
  onPreview,
  onResume,
  onReconnectFinalizer,
  onReassembleFinal,
  onRevalidateCompleted,
  onFullRetry,
}: {
  job: DetailPageReviewJob;
  resumeTarget: DetailPageReviewJob | null;
  workerReady: boolean;
  busy: boolean;
  currentBusy: boolean;
  onPreview: (asset: DetailPageReviewAsset) => void;
  onResume: () => void;
  onReconnectFinalizer: () => void;
  onReassembleFinal: () => void;
  onRevalidateCompleted: () => void;
  onFullRetry: () => void;
}) {
  const bucket = detailPageReviewBucket(job);
  const presentation = bucketPresentation(bucket);
  const recoveryJob = resumeTarget ?? job;
  const assets = detailPageReviewAssets(recoveryJob);
  const resumable = Boolean(resumeTarget);
  const recoveringPriorCheckpoint =
    Boolean(resumeTarget) && resumeTarget?.jobId !== job.jobId;
  const active = isActiveDetailPageJob(job);
  const canReassembleFinal = canReassembleCompletedDetailPageJob(job);
  const canRevalidateCompleted = canRevalidateCompletedDetailPageJob(job);
  const finalDetail = assets.detail[0];
  const problemAssets = [...assets.representatives, ...assets.panels].filter(
    (asset) => asset.problem,
  );
  const problemCountConfirmed =
    hasFullAssetDetailPageAssessment(recoveryJob);
  const standardDiagnostics =
    bucket === "needs_review"
      ? detailPageStandardDiagnostics(recoveryJob)
      : [];
  const exactProblemCountConfirmed =
    problemCountConfirmed || standardDiagnostics.length > 0;

  return (
    <div>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-black ${presentation.badge}`}>
              {presentation.label}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
              {detailPageStageLabel(job)}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
              시도 {job.attempt || 1}회
            </span>
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950">{detailPageJobName(job)}</h2>
          <p className="mt-1 text-xs font-bold text-slate-400">상품 ID {job.itemId} · 최근 갱신 {formatDateTime(job.updatedAt)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href={`/product-launch-tracker?detailPageItem=${encodeURIComponent(job.itemId)}`}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50"
          >
            상품 상세 열기
          </Link>
          {finalDetail ? (
            <button
              type="button"
              onClick={() => onPreview(finalDetail)}
              className="rounded-lg bg-slate-950 px-3.5 py-2.5 text-sm font-black text-white hover:bg-slate-800"
            >
              최종 상세페이지 보기
            </button>
          ) : null}
        </div>
      </div>

      <JobProgressMonitor
        job={job}
        presentation={presentation}
        busy={busy}
        currentBusy={currentBusy}
        onReconnectFinalizer={onReconnectFinalizer}
      />

      {bucket === "needs_review" ? (
        <section className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-black tracking-[0.12em] text-rose-500">AI 검수 판정</p>
              <h3 className="mt-1 text-lg font-black text-rose-950">
                {problemAssets.length
                  ? `${problemAssets.map((asset) => detailPageRoleLabel(asset.roleId)).join(", ")} 확인 필요`
                  : "생성 결과 확인 필요"}
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-rose-800">
                {detailPageProblemReason(recoveryJob)}
              </p>
              <p className="mt-2 text-xs font-bold text-rose-600">
                정상 자산은 삭제하지 않으며, 부분 재생성은 저장된 체크포인트를 사용합니다.
              </p>
              {recoveringPriorCheckpoint ? (
                <p className="mt-2 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-black leading-5 text-rose-700">
                  방금 생긴 5% 수집 실패 기록은 재사용하지 않습니다. 같은 상품의 직전 검수 체크포인트
                  (시도 {resumeTarget?.attempt || 1}회)를 복구하며 1688 재수집은 실행하지 않습니다.
                </p>
              ) : null}
              {!exactProblemCountConfirmed ? (
                <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-xs font-black leading-5 text-rose-700">
                  이 과거 판정은 상세 섹션 전체 검수 이전 기록입니다. 부분 재생성 시 전체 결과를 원본과 먼저 재검수합니다.
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {resumable ? (
                <button
                  type="button"
                  onClick={onResume}
                  disabled={busy}
                  className="rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-black text-white hover:bg-rose-700 disabled:cursor-wait disabled:opacity-40"
                >
                  {currentBusy
                    ? "재생성 요청 중…"
                    : standardDiagnostics.length
                      ? `차단된 상세 섹션 ${standardDiagnostics.length}장만 재생성`
                      : problemCountConfirmed && problemAssets.length
                      ? `문제 이미지 ${problemAssets.length}장만 재생성`
                      : "전체 재검수 후 문제 이미지만 재생성"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onFullRetry}
                disabled={!workerReady || busy}
                className="rounded-lg border border-rose-300 bg-white px-4 py-2.5 text-sm font-black text-rose-700 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-40"
              >
                전체 다시 생성
              </button>
            </div>
          </div>
        </section>
      ) : !active ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4">
          <p className="text-sm font-bold text-slate-600">
            {canRevalidateCompleted
              ? "모델명·판매옵션 기준이 바뀐 경우 저장 자산을 재검수해 문제 이미지만 다시 만들 수 있습니다."
              : canReassembleFinal
              ? "조립 템플릿만 바뀐 경우 저장 자산으로 최종 JPEG만 다시 만들 수 있습니다."
              : "결과를 다시 만들 필요가 있을 때만 전체 재생성을 사용하세요."}
          </p>
          <div className="flex flex-wrap gap-2">
            {canRevalidateCompleted ? (
              <button
                type="button"
                onClick={onRevalidateCompleted}
                disabled={busy}
                className="rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-black text-white hover:bg-amber-700 disabled:cursor-wait disabled:opacity-40"
              >
                {currentBusy
                  ? "재검수 요청 중…"
                  : "저장 자산 재검수·부분 재생성"}
              </button>
            ) : null}
            {canReassembleFinal ? (
              <button
                type="button"
                onClick={onReassembleFinal}
                disabled={busy}
                className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-40"
              >
                {currentBusy ? "최종 조립 요청 중…" : "최종 조립만 다시 실행"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onFullRetry}
              disabled={!workerReady || busy}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-40"
            >
              {currentBusy ? "재생성 요청 중…" : "전체 다시 생성"}
            </button>
          </div>
        </div>
      ) : null}

      {bucket === "needs_review" ? (
        <FailureDiagnosticSnapshot
          job={recoveryJob}
          diagnostics={standardDiagnostics}
        />
      ) : null}

      {standardDiagnostics.length ? (
        <StandardQualityDiagnostics
          diagnostics={standardDiagnostics}
          onRetry={onResume}
          disabled={!resumable || busy}
          pending={currentBusy}
        />
      ) : null}

      <AssetSection
        title="대표·부가 이미지"
        description="빨간 표시는 AI 최종 검수에서 지목된 문제 이미지입니다. 이미지를 누르면 원본 크기로 확대합니다."
        assets={assets.representatives}
        empty="아직 생성된 대표·부가 이미지가 없습니다."
        onPreview={onPreview}
      />
      <AssetSection
        title="상세페이지 섹션 이미지"
        description="상세 섹션도 원본 상품과 대조합니다. 빨간 표시된 섹션만 재생성하고 정상 섹션은 유지합니다."
        assets={assets.panels}
        empty="아직 저장된 상세 섹션 이미지가 없습니다."
        onPreview={onPreview}
      />
      <AssetSection
        title="1688 원본 참고 이미지"
        description={`수집된 원본 ${assets.evidence.length}장을 생성 결과와 비교할 수 있습니다. 광고·연관상품은 보정 재생성 입력에서 제외됩니다.`}
        assets={assets.evidence}
        empty="1688 원본 수집 이미지가 없습니다."
        onPreview={onPreview}
        collapsed={assets.evidence.length > 8}
      />

      <details className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-black text-slate-800">작업 상세 정보</summary>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <DetailCell label="작업 ID" value={job.jobId} mono />
          <DetailCell label="현재 단계" value={detailPageStageLabel(job)} />
          <DetailCell label="검수 상태" value={job.qaStatus === "passed" ? "통과" : job.qaStatus === "failed" ? "실패" : "진행 중"} />
          <DetailCell label="시작" value={formatDateTime(job.startedAt || job.createdAt)} />
          <DetailCell label="완료" value={job.completedAt ? formatDateTime(job.completedAt) : "진행 중"} />
          <DetailCell label="1688 원본" value={`${assets.evidence.length}장`} />
        </dl>
        {job.sourceUrl ? (
          <a href={job.sourceUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex text-sm font-black text-blue-700 hover:underline">
            1688 상품 링크 열기
          </a>
        ) : null}
      </details>
    </div>
  );
}

function JobProgressMonitor({
  job,
  presentation,
  busy,
  currentBusy,
  onReconnectFinalizer,
}: {
  job: DetailPageReviewJob;
  presentation: ReturnType<typeof bucketPresentation>;
  busy: boolean;
  currentBusy: boolean;
  onReconnectFinalizer: () => void;
}) {
  const progress = safeProgress(job.progress);
  const payload =
    job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
      ? job.payload
      : {};
  const result =
    job.result && typeof job.result === "object" && !Array.isArray(job.result)
      ? job.result
      : {};
  const finalizerPhase = String(
    result.finalizerPhase || payload.finalizer_phase || "",
  );
  const finalizerHeartbeatAt = String(
    result.finalizerHeartbeatAt || payload.finalizer_heartbeat_at || job.updatedAt,
  );
  const finalizerStartedAt = String(
    result.finalizerStartedAt ||
      payload.finalizer_started_at ||
      job.startedAt ||
      job.createdAt,
  );
  const finalizerAttempt = Math.max(
    1,
    Math.floor(Number(payload.finalizer_attempt) || 1),
  );
  const completedAssets = Math.max(
    0,
    Math.floor(
      Number(
        result.finalizerCompletedAssets ||
          payload.finalizer_completed_assets,
      ) || 0,
    ),
  );
  const totalAssets = Math.max(
    0,
    Math.floor(
      Number(
        result.finalizerTotalAssets || payload.finalizer_total_assets,
      ) || 0,
    ),
  );
  const assetLabel = String(
    result.finalizerAssetLabel || payload.finalizer_asset_label || "",
  ).trim();
  const errorCode = String(payload.finalizer_error_code || "").trim();
  const isFinalizer = isRecoverableServerFinalAssemblyJob(job);
  const heartbeatAt = isFinalizer ? finalizerHeartbeatAt : job.updatedAt;
  const phaseStartedAt = isFinalizer
    ? finalizerStartedAt
    : job.startedAt || job.createdAt;
  const heartbeatAge = elapsedMilliseconds(heartbeatAt);
  const stalledFinalizer =
    isFinalizer &&
    (job.status === "failed" ||
      finalizerPhase === "failed" ||
      heartbeatAge >= 30_000);

  return (
    <section className="mt-5 rounded-2xl border border-blue-300 bg-blue-50 p-4 shadow-sm" aria-label="상세페이지 작업 현황">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black text-blue-700">상세페이지 작업 현황</p>
          <h3 className="mt-1 text-lg font-black text-blue-950">{detailPageStageLabel(job)}</h3>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-black ${presentation.badge}`}>
          {presentation.label}
        </span>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${presentation.bar}`} style={{ width: `${progress}%` }} />
      </div>

      <dl className="mt-4 grid gap-x-8 gap-y-2 text-xs font-bold text-blue-900 sm:grid-cols-2 xl:grid-cols-3">
        <ProgressMetric label="진행" value={`${progress}%`} />
        <ProgressMetric
          label={isFinalizer ? "실제 조립 단계" : "현재 단계"}
          value={
            isFinalizer
              ? finalizerPhaseLabel(finalizerPhase)
              : detailPageStageLabel(job)
          }
        />
        <ProgressMetric
          label={isFinalizer ? "이번 조립 경과" : "경과"}
          value={formatElapsed(phaseStartedAt, job.completedAt)}
        />
        <ProgressMetric
          label={isFinalizer ? "최근 실제 진행" : "최근 heartbeat"}
          value={formatRelativeAge(heartbeatAt)}
        />
        <ProgressMetric
          label={isFinalizer ? "조립 시도 횟수" : "시도 횟수"}
          value={`${isFinalizer ? finalizerAttempt : job.attempt || 1}회`}
        />
        <ProgressMetric label="상태" value={job.status.toUpperCase()} mono />
        {isFinalizer && totalAssets > 0 ? (
          <ProgressMetric
            label="저장 이미지"
            value={`${completedAssets}/${totalAssets}장${assetLabel ? ` · ${assetLabel}` : ""}`}
          />
        ) : null}
        {isFinalizer && errorCode ? (
          <ProgressMetric label="오류 코드" value={errorCode} mono />
        ) : null}
      </dl>

      <p className="mt-4 text-sm font-bold leading-6 text-blue-900">
        {job.message || presentation.detail}
      </p>

      {stalledFinalizer ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-black text-amber-900">
            {finalizerPhase === "failed"
              ? `최종 조립 오류가 확인됐습니다.${job.error ? ` ${job.error}` : ""}`
              : "최종 조립의 실제 진행이 30초 이상 갱신되지 않았습니다. 단순 대기가 아니라 현재 단계가 멈춘 상태일 수 있습니다."}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] font-bold leading-5 text-amber-800">
              1688 재수집·AI 재생성 없이 저장된 대표·부가 5장과 상세 섹션만 서버에서 조립합니다.
            </p>
            <button
              type="button"
              onClick={onReconnectFinalizer}
              disabled={busy}
              className="rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-black text-white hover:bg-blue-800 disabled:cursor-wait disabled:bg-slate-300 disabled:text-slate-600"
            >
              {currentBusy ? "서버 조립 시작 중…" : "서버 최종 조립 다시 시작"}
            </button>
          </div>
        </div>
      ) : null}

      <p className="mt-4 break-all font-mono text-[10px] font-bold text-blue-600">job_id: {job.jobId}</p>
    </section>
  );
}

function ProgressMetric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="shrink-0 text-blue-700">{label}:</dt>
      <dd className={`min-w-0 break-words text-blue-950 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function finalizerPhaseLabel(phase: string) {
  const labels: Record<string, string> = {
    asset_check: "대표·부가 이미지 저장 확인",
    asset_loading: "상세 섹션 저장 이미지 로딩",
    document_loading: "서버 조립 문서 준비",
    rendering: "서버 14,000px 렌더링",
    encoding: "최종 JPEG 확인",
    complete: "서버 조립 완료",
    connecting: "조립기 연결",
    engine_ready: "저장 결과 전달",
    snapshot_received: "저장 결과 확인",
    asset_loaded: "저장 이미지 다운로드",
    render_waiting: "렌더러 응답 대기",
    failed: "복구 가능한 조립 실패",
  };
  return labels[phase] || "조립 연결 대기";
}

function FailureDiagnosticSnapshot({
  job,
  diagnostics,
}: {
  job: DetailPageReviewJob;
  diagnostics: DetailPageStandardPanelDiagnostic[];
}) {
  const checkpointId = detailPageCheckpointId(job);
  return (
    <section className="mt-5 rounded-xl border border-slate-300 bg-slate-950 p-4 text-white">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-black tracking-[0.12em] text-slate-400">캡처용 오류 진단</p>
          <h3 className="mt-1 text-base font-black">이 영역이 보이게 캡처하면 작업 이력을 바로 추적할 수 있습니다.</h3>
        </div>
        <span className="rounded-full bg-rose-500/20 px-3 py-1 text-xs font-black text-rose-200">
          {detailPageFailureCode(job)}
        </span>
      </div>
      <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
        <DiagnosticCell label="작업 ID" value={job.jobId} mono />
        <DiagnosticCell label="실제 단계 코드" value={job.stage || "unknown"} mono />
        <DiagnosticCell label="진행·시도" value={`${safeProgress(job.progress)}% · 시도 ${job.attempt || 1}회`} />
        <DiagnosticCell label="체크포인트 run_id" value={checkpointId || "기록 없음"} mono />
        <DiagnosticCell label="차단 자산" value={diagnostics.length ? `상세 섹션 ${diagnostics.map((item) => item.slot).join(", ")}` : "구형 기록 · 재검수 필요"} />
        <DiagnosticCell label="마지막 갱신" value={formatDateTime(job.updatedAt)} />
      </dl>
    </section>
  );
}

function StandardQualityDiagnostics({
  diagnostics,
  onRetry,
  disabled,
  pending,
}: {
  diagnostics: DetailPageStandardPanelDiagnostic[];
  onRetry: () => void;
  disabled: boolean;
  pending: boolean;
}) {
  return (
    <section className="mt-5 overflow-hidden rounded-xl border border-rose-200 bg-white">
      <div className="border-b border-rose-100 bg-rose-50 px-4 py-3">
        <h3 className="font-black text-rose-950">Standard-v2 차단 상세 섹션</h3>
        <p className="mt-1 text-xs font-bold text-rose-700">섹션별 실제 점수/하한, 결함, 재생성 범위를 한 번에 확인합니다.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[880px] w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-black">문제 섹션</th>
              <th className="px-4 py-3 font-black">검수 상태</th>
              <th className="px-4 py-3 font-black">실제 점수 / 하한</th>
              <th className="px-4 py-3 font-black">차단 사유·결함</th>
              <th className="px-4 py-3 font-black">재시도</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {diagnostics.map((item) => (
              <tr key={item.roleId} className="align-top">
                <td className="px-4 py-3">
                  <p className="font-black text-rose-700">{item.label}</p>
                  <p className="mt-1 font-mono text-[10px] text-slate-400">{item.roleId}</p>
                </td>
                <td className="px-4 py-3 font-bold text-slate-700">
                  {qualityStatusLabel(item.status)}
                  {item.policyLabel ? <p className="mt-1 text-[10px] text-slate-400">{item.policyLabel}</p> : null}
                </td>
                <td className="px-4 py-3 font-mono font-bold leading-5 text-slate-700">
                  <p>형태 {scorePair(item.scores.shape, item.scoreFloors.shape)}</p>
                  <p>정체성 {scorePair(item.scores.identity, item.scoreFloors.identity)}</p>
                  <p>장면 {scorePair(item.scores.sceneContext, item.scoreFloors.sceneContext)}</p>
                  <p>크기 {scorePair(item.scores.size, item.scoreFloors.size)}</p>
                </td>
                <td className="max-w-md px-4 py-3 font-semibold leading-5 text-slate-700">
                  <p>{item.blockerLabels.join(" · ") || "상세 판정 확인 필요"}</p>
                  {item.issueLabels.length ? <p className="mt-1 font-black text-rose-700">결함: {item.issueLabels.join(", ")}</p> : null}
                  {item.reason ? <p className="mt-1 text-[11px] text-slate-500">{item.reason}</p> : null}
                </td>
                <td className="px-4 py-3">
                  {item.retryable ? (
                    <button
                      type="button"
                      onClick={onRetry}
                      disabled={disabled}
                      aria-label={`${item.label}만 재생성`}
                      className="inline-flex whitespace-nowrap rounded-lg bg-rose-600 px-3 py-2 text-xs font-black text-white shadow-sm transition hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 disabled:cursor-wait disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none"
                    >
                      {pending ? "재생성 요청 중…" : "이 섹션만 재생성"}
                    </button>
                  ) : (
                    <span className="font-black text-slate-700">사용자 검토</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DiagnosticCell({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg bg-white/10 p-3">
      <dt className="font-black text-slate-400">{label}</dt>
      <dd className={`mt-1 break-all font-bold text-white ${mono ? "font-mono text-[11px]" : ""}`}>{value}</dd>
    </div>
  );
}

function qualityStatusLabel(status: string) {
  if (status === "review_required") return "검토 필요";
  if (status === "unavailable") return "검수 정보 없음";
  if (status === "passed") return "점수 하한 재확인";
  return status || "상태 미상";
}

function scorePair(score: number | null, floor: number | null) {
  if (score === null || score < 0) return "해당 없음";
  return floor === null ? String(score) : `${score} / ${floor}`;
}

function AssetSection({
  title,
  description,
  assets,
  empty,
  onPreview,
  collapsed = false,
}: {
  title: string;
  description: string;
  assets: DetailPageReviewAsset[];
  empty: string;
  onPreview: (asset: DetailPageReviewAsset) => void;
  collapsed?: boolean;
}) {
  const [expanded, setExpanded] = useState(!collapsed);
  const visible = expanded ? assets : assets.slice(0, 8);
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-950">{title}</h3>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{description}</p>
        </div>
        {assets.length > 8 ? (
          <button type="button" onClick={() => setExpanded((value) => !value)} className="text-xs font-black text-blue-700 hover:underline">
            {expanded ? "접기" : `전체 ${assets.length}장 보기`}
          </button>
        ) : null}
      </div>
      {visible.length ? (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {visible.map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => onPreview(asset)}
              className={`group overflow-hidden rounded-xl border bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${asset.problem ? "border-2 border-rose-500 ring-4 ring-rose-100" : "border-slate-200"}`}
            >
              <div className="relative aspect-square overflow-hidden bg-slate-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset.url} alt={asset.label} className="h-full w-full object-contain transition-transform group-hover:scale-[1.02]" />
                {asset.problem ? (
                  <span className="absolute left-2 top-2 rounded-full bg-rose-600 px-2.5 py-1 text-[10px] font-black text-white shadow">문제 이미지</span>
                ) : null}
                <span className="absolute bottom-2 right-2 rounded-md bg-slate-950/75 px-2 py-1 text-[10px] font-black text-white">확대</span>
              </div>
              <p className={`truncate px-3 py-2 text-xs font-black ${asset.problem ? "text-rose-700" : "text-slate-700"}`}>{asset.label}</p>
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">{empty}</p>
      )}
    </section>
  );
}

function ImagePreview({ asset, onClose }: { asset: DetailPageReviewAsset; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/90 p-4" role="dialog" aria-modal="true" aria-label={`${asset.label} 확대보기`} onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3">
          <div>
            <p className="font-black text-slate-950">{asset.label}</p>
            <p className="mt-0.5 text-xs font-bold text-slate-400">{asset.problem ? "AI 검수 문제 이미지" : "클릭한 이미지 원본"}</p>
          </div>
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-lg bg-slate-100 text-xl font-black text-slate-700 hover:bg-slate-200" aria-label="확대보기 닫기">×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset.url} alt={asset.label} className="mx-auto max-h-[78vh] max-w-full object-contain" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
          <p className="text-xs font-bold text-slate-500">새 탭에서 실제 저장 크기로도 확인할 수 있습니다.</p>
          <a href={asset.url} target="_blank" rel="noreferrer" className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white hover:bg-slate-800">원본 새 탭 열기</a>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone, detail }: { label: string; value: number; tone: "red" | "blue" | "green" | "slate"; detail: string }) {
  const tones = {
    red: "border-rose-200 bg-rose-50 text-rose-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    slate: "border-slate-200 bg-white text-slate-700",
  };
  return (
    <article className={`rounded-2xl border p-5 shadow-sm ${tones[tone]}`}>
      <p className="text-xs font-black">{label}</p>
      <p className="mt-2 text-3xl font-black tracking-tight">{value.toLocaleString("ko-KR")}건</p>
      <p className="mt-2 text-xs font-bold opacity-70">{detail}</p>
    </article>
  );
}

function DetailCell({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <dt className="text-xs font-black text-slate-400">{label}</dt>
      <dd className={`mt-1 break-all font-bold text-slate-800 ${mono ? "font-mono text-xs" : "text-sm"}`}>{value}</dd>
    </div>
  );
}

function countJobs(jobs: DetailPageReviewJob[]) {
  return jobs.reduce(
    (counts, job) => {
      counts[detailPageReviewBucket(job)] += 1;
      return counts;
    },
    { needs_review: 0, active: 0, passed: 0, cancelled: 0 } as Record<DetailPageReviewBucket, number>,
  );
}

function filterCount(
  filter: Filter,
  counts: Record<DetailPageReviewBucket, number>,
  total: number,
) {
  return filter === "all" ? total : counts[filter];
}

function bucketPresentation(bucket: DetailPageReviewBucket) {
  const values = {
    needs_review: { label: "검수 필요", detail: "생성 결과 확인 필요", badge: "bg-rose-100 text-rose-700", bar: "bg-rose-500" },
    active: { label: "진행 중", detail: "서버에서 계속 처리 중", badge: "bg-blue-100 text-blue-700", bar: "bg-blue-600" },
    passed: { label: "검수 통과", detail: "최종 도킹 완료", badge: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-500" },
    cancelled: { label: "종료", detail: "취소되거나 종료된 작업", badge: "bg-slate-200 text-slate-600", bar: "bg-slate-400" },
  };
  return values[bucket];
}

function safeProgress(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? Math.round(value) : 0));
}

function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "시간 미상";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "시간 미상";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function elapsedMilliseconds(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, Date.now() - timestamp) : 0;
}

function formatRelativeAge(value: string) {
  const elapsed = elapsedMilliseconds(value);
  if (elapsed < 1_000) return "방금 전";
  return `${formatDuration(elapsed)} 전`;
}

function formatElapsed(startedAt: string, completedAt: string | null) {
  const start = Date.parse(startedAt);
  const end = completedAt ? Date.parse(completedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "시간 미상";
  return formatDuration(Math.max(0, end - start));
}

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours}시간 ${minutes}분 ${remainder}초`;
  if (minutes) return `${minutes}분 ${remainder}초`;
  return `${remainder}초`;
}

function isReviewJob(value: unknown): value is DetailPageReviewJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<DetailPageReviewJob>;
  return Boolean(job.jobId && job.itemId && job.status);
}
