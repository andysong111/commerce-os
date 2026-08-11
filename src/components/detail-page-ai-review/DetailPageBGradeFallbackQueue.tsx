"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DetailPageReviewJob } from "@/lib/detailPageAiReview";
import { v260807ManualDecisionKind } from "@/lib/detailPageManualDecision";

const JOBS_API = "/api/product-launch-tracker/detail-page-jobs";
const POLL_MS = 2_500;
const DECORATE_MS = 500;
const COMPLETED_B_GRADE_RERUN_ACTION = "rerun_completed_b_grade";
const INLINE_ACTION_ATTR = "data-b-grade-inline-action";

export function DetailPageBGradeFallbackQueue() {
  const [jobs, setJobs] = useState<DetailPageReviewJob[]>([]);
  const [busyJobId, setBusyJobId] = useState("");

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

  const runBGrade = useCallback(
    async (job: DetailPageReviewJob) => {
      if (busyJobId) return;
      const name = productName(job);
      const retry = isBGradeFailed(job);
      const completed = isCompletedBGrade(job);
      const confirmed = window.confirm(
        completed
          ? `"${name}"은 B급 검수 통과 완료 작업입니다.\n\n현재 상품출시진행관리에 연결된 결과는 그대로 유지한 채 저장된 1688 원본·상품 분석·판매옵션을 재사용해 B급 엔진으로 다시 생성합니다. 새 결과가 성공한 뒤에만 현재 결과를 교체합니다.\n\nB급 엔진으로 재생성하시겠습니까?`
          : retry
            ? `"${name}"의 B급 작업이 중단되었습니다.\n\n기존 1688 원본·상품 분석·판매옵션은 그대로 유지하고 B급 엔진을 다시 실행합니다. 실패한 실행의 자동 재결제는 하지 않습니다.\n\nB급 엔진 다시 실행하시겠습니까?`
            : `"${name}"은 A급 AI 이미지 생성 안전검사에서 차단되었습니다.\n\nB급 엔진은 저장된 1688 원본을 중심으로 상세페이지를 조립하고 대표이미지 1장만 생성합니다.\n\nB급 엔진으로 실행하시겠습니까?`,
      );
      if (!confirmed) return;

      setBusyJobId(job.jobId);
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
        await refresh();
      } catch (error) {
        window.alert(
          error instanceof Error
            ? error.message
            : "B급 엔진 전환을 실행하지 못했습니다.",
        );
        await refresh();
      } finally {
        setBusyJobId("");
      }
    },
    [busyJobId, refresh],
  );

  useEffect(() => {
    function decorateVisibleCards() {
      const list = Array.from(document.querySelectorAll("div")).find((element) => {
        const className = element.getAttribute("class") || "";
        return (
          className.includes("max-h-[760px]") &&
          className.includes("overflow-y-auto")
        );
      });
      if (!list) return;

      const cards = Array.from(list.children).filter(
        (element): element is HTMLButtonElement =>
          element instanceof HTMLButtonElement,
      );
      const targetIds = new Set(targets.map((job) => job.jobId));

      document
        .querySelectorAll<HTMLElement>(`[${INLINE_ACTION_ATTR}]`)
        .forEach((element) => {
          const jobId = element.getAttribute(INLINE_ACTION_ATTR) || "";
          if (!targetIds.has(jobId) || !list.contains(element)) {
            element.remove();
          }
        });

      for (const job of targets) {
        const card = cards.find((candidate) =>
          (candidate.textContent || "").includes(job.itemId),
        );
        if (!card) continue;

        let action = card.querySelector<HTMLElement>(
          `[${INLINE_ACTION_ATTR}="${job.jobId}"]`,
        );
        const completed = isCompletedBGrade(job);
        const retry = isBGradeFailed(job);
        const busy = busyJobId === job.jobId;
        const label = busy
          ? "B급 재생성 중…"
          : completed
            ? "B급으로 재생성"
            : retry
              ? "B급 다시 실행"
              : "B급으로 실행";

        if (!action) {
          action = document.createElement("span");
          action.setAttribute(INLINE_ACTION_ATTR, job.jobId);
          action.setAttribute("role", "button");
          action.setAttribute(
            "aria-label",
            completed ? "B급 엔진으로 재생성" : "B급 엔진으로 실행",
          );
          action.style.display = "inline-flex";
          action.style.alignItems = "center";
          action.style.justifyContent = "center";
          action.style.marginTop = "10px";
          action.style.padding = "5px 9px";
          action.style.borderRadius = "7px";
          action.style.fontSize = "11px";
          action.style.fontWeight = "900";
          action.style.lineHeight = "1.2";
          action.style.color = "white";
          action.style.boxShadow = "0 1px 2px rgba(15,23,42,.12)";
          action.style.cursor = "pointer";
          action.style.userSelect = "none";
          action.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            event.stopPropagation();
          });
          action.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            void runBGrade(job);
          });
          card.appendChild(action);
        }

        action.textContent = label;
        action.style.background = completed ? "#047857" : "#c2410c";
        action.style.opacity = busy ? "0.55" : "1";
        action.style.pointerEvents = busy ? "none" : "auto";
      }
    }

    decorateVisibleCards();
    const interval = window.setInterval(decorateVisibleCards, DECORATE_MS);
    return () => {
      window.clearInterval(interval);
      document
        .querySelectorAll<HTMLElement>(`[${INLINE_ACTION_ATTR}]`)
        .forEach((element) => element.remove());
    };
  }, [busyJobId, runBGrade, targets]);

  // Intentionally no standalone B-grade queue UI. The action is injected as a
  // compact control inside each eligible job card in the scrollable review list.
  return null;
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
