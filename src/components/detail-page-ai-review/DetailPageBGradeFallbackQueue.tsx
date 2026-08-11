"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DetailPageReviewJob } from "@/lib/detailPageAiReview";
import { v260807ManualDecisionKind } from "@/lib/detailPageManualDecision";

const JOBS_API = "/api/product-launch-tracker/detail-page-jobs";
const POLL_MS = 2_500;

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

  const blocked = useMemo(
    () =>
      jobs.filter(
        (job) =>
          v260807ManualDecisionKind(job) === "generation_safety_block" ||
          isBGradeFailed(job),
      ),
    [jobs],
  );

  async function runBGrade(job: DetailPageReviewJob) {
    if (busyJobId) return;
    const name = productName(job);
    const retry = isBGradeFailed(job);
    if (
      !window.confirm(
        retry
          ? `"${name}"의 B급 엔진 작업이 구성 단계에서 중단되었습니다.\n\n기존 1688 원본·상품 분석·판매옵션은 그대로 유지하고, 최신 B급 하이브리드 규칙으로 다시 실행합니다. 후킹포인트만 AI 1장을 시도하며 차단되면 자동으로 원본 사용예시로 전환합니다.\n\nB급 엔진을 다시 실행하시겠습니까?`
          : `"${name}"은 A급 AI 이미지 생성 안전검사에서 차단되었습니다.\n\nB급 엔진은 대표·부가·포인트·사용·옵션을 1688 원본 중심으로 조립하고, 후킹포인트에만 일반적인 불편 사용장면 AI 1장을 시도합니다. 후킹 AI도 차단되면 전체를 실패시키지 않고 원본형 후킹으로 자동 전환합니다.\n\nB급 엔진으로 실행하시겠습니까?`,
      )
    ) {
      return;
    }

    setBusyJobId(job.jobId);
    setNotice(
      retry
        ? "기존 자산을 유지하고 최신 B급 하이브리드 엔진을 다시 시작합니다."
        : "B급 하이브리드 전환을 저장하고 서버 작업을 시작합니다.",
    );
    try {
      const response = await fetch(
        `${JOBS_API}/${encodeURIComponent(job.jobId)}/b-grade`,
        {
          method: "POST",
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
          startBody.message || "B급 하이브리드 서버 작업을 시작하지 못했습니다.",
        );
      }
      setNotice(
        "B급 하이브리드 엔진을 시작했습니다. 후킹포인트 AI는 최대 1회 보정 후 실패하면 자동으로 1688 원본형 후킹으로 전환합니다.",
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

  if (!blocked.length) return null;

  return (
    <section className="mb-5 rounded-2xl border border-orange-300 bg-orange-50 p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-black tracking-[0.14em] text-orange-700">
            Commerce OS Detail Page Studio · v260807 · B급 하이브리드
          </p>
          <h2 className="mt-1 text-lg font-black text-orange-950">
            B급 엔진 대상 {blocked.length}건
          </h2>
          <p className="mt-1 text-sm font-semibold leading-6 text-orange-900">
            A급 생성이 안전검사에서 반복 차단되는 상품의 최후 안정망입니다. 대표·부가·본문·옵션은 1688 원본을 우선 사용하고, 판매력을 보완할 후킹포인트에만 일반적인 불편 장면 AI 1장을 제한적으로 사용합니다. 후킹 AI 실패는 전체 실패 사유가 아닙니다.
          </p>
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
        {blocked.map((job) => {
          const retry = isBGradeFailed(job);
          return (
            <article
              key={job.jobId}
              className="flex flex-col gap-3 rounded-xl border border-orange-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between"
            >
              <div>
                <h3 className="font-black text-slate-950">{productName(job)}</h3>
                <p className="mt-1 text-xs font-bold text-slate-500">{job.itemId}</p>
                <p className="mt-2 text-sm font-semibold text-slate-700">
                  {retry
                    ? "이 작업은 이전 B급 조립에서 중단되었습니다. 저장된 원본과 분석을 그대로 유지하고 최신 B급 하이브리드 규칙으로 다시 실행할 수 있습니다."
                    : "안전검사에서 차단되어 B급 엔진으로 실행하시겠습니까? 대표·부가·본문은 원본 중심으로 유지하고 후킹포인트만 일반적인 불편 장면 AI를 1장 시도합니다."}
                </p>
              </div>
              <button
                type="button"
                disabled={Boolean(busyJobId)}
                onClick={() => void runBGrade(job)}
                className="shrink-0 rounded-lg bg-orange-700 px-4 py-2.5 text-sm font-black text-white hover:bg-orange-800 disabled:cursor-wait disabled:opacity-40"
              >
                {busyJobId === job.jobId
                  ? "B급 엔진 전환 중…"
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

function isBGradeFailed(job: DetailPageReviewJob) {
  return (
    job.status === "failed" &&
    ((job.stage === "v3_b_grade_source_only" &&
      /B_GRADE_SOURCE_ONLY_FAILED/i.test(job.error || "")) ||
      (job.stage === "v3_b_grade_hybrid" &&
        /B_GRADE_HYBRID_FAILED/i.test(job.error || "")))
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
