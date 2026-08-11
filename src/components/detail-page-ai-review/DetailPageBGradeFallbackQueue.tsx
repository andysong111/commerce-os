"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DetailPageReviewJob } from "@/lib/detailPageAiReview";
import { v260807ManualDecisionKind } from "@/lib/detailPageManualDecision";

const JOBS_API = "/api/product-launch-tracker/detail-page-jobs";
const POLL_MS = 2_500;
const COMPLETED_B_GRADE_RERUN_ACTION = "rerun_completed_b_grade";

export function DetailPageBGradeFallbackQueue() {
  const [jobs, setJobs] = useState<DetailPageReviewJob[]>([]);
  const [busyJobId, setBusyJobId] = useState("");
  const [notice, setNotice] = useState("");

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
        setJobs(body.jobs);
      }
    } catch {
      // Main review workspace remains the durable error surface.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const targets = useMemo(
    () =>
      jobs.filter(
        (job) =>
          v260807ManualDecisionKind(job) === "generation_safety_block" ||
          isBGradeFailed(job) ||
          isCompletedBGrade(job),
      ),
    [jobs],
  );

  async function runBGrade(job: DetailPageReviewJob) {
    if (busyJobId) return;
    const name = productName(job);
    const retry = isBGradeFailed(job);
    const completed = isCompletedBGrade(job);
    if (
      !window.confirm(
        completed
          ? `"${name}"은 B급 엔진으로 검수 통과한 완료 작업입니다.\n\n현재 상품출시진행관리에 연결된 결과는 그대로 유지한 채, 저장된 1688 원본·상품 분석·판매옵션을 재사용해 B급 엔진으로 다시 생성합니다. B급은 상세페이지를 원본 중심으로 유지하고 대표이미지 1장만 생성하며 부가이미지는 생성하지 않습니다. 새 결과가 성공한 뒤에만 현재 결과를 교체합니다.\n\nB급 엔진으로 재생성하시겠습니까?`
          : retry
            ? `"${name}"의 B급 작업이 중단되었습니다.\n\n기존 1688 원본·상품 분석·판매옵션은 그대로 유지합니다. 상세페이지는 원본 중심으로 조립하고 대표이미지 1장만 one-shot으로 생성하며 부가이미지는 생성하지 않습니다. 실패한 실행의 자동 재결제는 하지 않습니다.\n\nB급 엔진을 다시 실행하시겠습니까?`
            : `"${name}"은 A급 AI 이미지 생성 안전검사에서 차단되었습니다.\n\nB급 엔진은 상세페이지 본문은 저장된 1688 원본을 중심으로 조립하고, 대표이미지 1장만 제한적으로 생성합니다. 부가이미지는 생성하지 않습니다.\n\nB급 엔진으로 실행하시겠습니까?`,
      )
    ) {
      return;
    }

    setBusyJobId(job.jobId);
    setNotice(
      completed
        ? "현재 검수 통과 결과를 보존하고 B급 재생성을 준비합니다."
        : retry
          ? "기존 원본과 분석을 유지하고 B급 작업을 다시 시작합니다."
          : "B급 엔진 전환을 저장하고 서버 작업을 시작합니다.",
    );
    try {
      const response = await fetch(
        `${JOBS_API}/${encodeURIComponent(job.jobId)}/b-grade`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            completed ? { action: COMPLETED_B_GRADE_RERUN_ACTION } : {},
          ),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || body.ok !== true) {
        throw new Error(body.message || "B급 엔진 전환을 저장하지 못했습니다.");
      }

      const startResponse = await fetch(
        `${JOBS_API}/${encodeURIComponent(job.jobId)}/start`,
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "b_grade_source_only" }),
        },
      );
      const startBody = (await startResponse.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!startResponse.ok || startBody.ok !== true) {
        throw new Error(
          startBody.message || "B급 서버 작업을 시작하지 못했습니다.",
        );
      }
      setNotice(
        completed
          ? "B급 엔진 재생성을 시작했습니다. 새 결과가 성공하기 전까지 기존 상품상세 결과는 유지됩니다."
          : "B급 엔진을 다시 시작했습니다. 저장된 1688 원본과 분석을 재사용하며 대표이미지 1장만 생성합니다.",
      );
      await refresh();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "B급 엔진 전환을 실행하지 못했습니다.",
      );
      await refresh();
    } finally {
      setBusyJobId("");
    }
  }

  if (!targets.length) return null;

  const completedCount = targets.filter(isCompletedBGrade).length;
  const recoveryCount = targets.length - completedCount;

  return (
    <section className="mb-5 rounded-2xl border border-orange-300 bg-orange-50 p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-black tracking-[0.14em] text-orange-700">
            Commerce OS Detail Page Studio · v260807 · B급 대표 1장
          </p>
          <h2 className="mt-1 text-lg font-black text-orange-950">
            B급 엔진 실행·재생성 {targets.length}건
          </h2>
          <p className="mt-1 text-sm font-semibold leading-6 text-orange-900">
            A급 생성이 안전검사에서 차단되는 상품은 저장된 1688 원본을 중심으로 상세페이지를 조립하고 대표이미지 1장만 생성합니다. 부가이미지는 생성하지 않습니다.
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-black">
            {recoveryCount ? (
              <span className="rounded-full bg-orange-100 px-2.5 py-1 text-orange-800">
                복구 대상 {recoveryCount}건
              </span>
            ) : null}
            {completedCount ? (
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">
                검수 통과 B급 재생성 {completedCount}건
              </span>
            ) : null}
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-orange-300 bg-white px-3 py-1.5 text-xs font-black text-orange-800">
          기존 A급 엔진은 변경 없음
        </span>
      </div>

      {notice ? (
        <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm font-bold text-orange-800">
          {notice}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3">
        {targets.map((job) => {
          const retry = isBGradeFailed(job);
          const completed = isCompletedBGrade(job);
          return (
            <article
              key={job.jobId}
              className="flex flex-col gap-3 rounded-xl border border-orange-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-black text-slate-950">{productName(job)}</h3>
                  {completed ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-black text-emerald-800">
                      B급 검수 통과
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs font-bold text-slate-500">{job.itemId}</p>
                <p className="mt-2 text-sm font-semibold text-slate-700">
                  {completed
                    ? "현재 완료 결과를 보존한 채 같은 1688 원본·분석·판매옵션으로 B급 엔진을 다시 실행할 수 있습니다. 새 결과가 성공한 뒤에만 상품상세를 교체합니다."
                    : retry
                      ? "이 작업은 이전 B급 실행에서 중단되었습니다. 저장된 원본과 분석을 유지하고 대표이미지 1장만 다시 생성할 수 있습니다."
                      : "안전검사에서 차단되어 B급 엔진으로 실행하시겠습니까? 상세페이지 본문은 1688 원본 중심, 마켓 이미지는 대표 1장만 생성합니다."}
                </p>
              </div>
              <button
                type="button"
                disabled={Boolean(busyJobId)}
                onClick={() => void runBGrade(job)}
                className={`shrink-0 rounded-lg px-4 py-2.5 text-sm font-black text-white disabled:cursor-wait disabled:opacity-40 ${
                  completed
                    ? "bg-emerald-700 hover:bg-emerald-800"
                    : "bg-orange-700 hover:bg-orange-800"
                }`}
              >
                {busyJobId === job.jobId
                  ? completed
                    ? "B급 재생성 시작 중…"
                    : "B급 엔진 전환 중…"
                  : completed
                    ? "B급 엔진으로 재생성"
                    : retry
                      ? "B급 엔진 다시 실행"
                      : "B급 엔진으로 실행"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function isCompletedBGrade(job: DetailPageReviewJob) {
  if (job.status !== "success") return false;
  const result = record(job.result);
  const engine = record(result.bGradeEngine);
  const request = record(result.bGradeEngineRequest);
  return (
    engine.id === "source-only-b-grade-v1" ||
    request.id === "source-only-b-grade-v1" ||
    engine.id === "b-grade-hybrid-v2" ||
    request.id === "b-grade-hybrid-v2" ||
    result.bGradeSourceOnly === true ||
    result.representativeQualityProof === "seller-source-only-no-ai-generation" ||
    (result.qualityTier === "B" && result.bGradeSourceFirst === true)
  );
}

function isBGradeFailed(job: DetailPageReviewJob) {
  const error = job.error || "";
  return (
    job.status === "failed" &&
    ((job.stage === "v3_b_grade_source_only" &&
      /B_GRADE_SOURCE_ONLY_FAILED/i.test(error)) ||
      (job.stage === "v3_b_grade_hybrid" &&
        /B_GRADE_HYBRID_FAILED/i.test(error)) ||
      (["v3_b_grade_source_only", "v3_b_grade_source_only_assembly"].includes(
        job.stage,
      ) && /DETAIL_PAGE_STEP_OUTCOME_UNKNOWN/i.test(error)))
  );
}

function productName(job: DetailPageReviewJob) {
  const payload = record(job.payload);
  return String(
    payload.product_name_hint || payload.product_name || job.itemId || "상품",
  ).trim();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
