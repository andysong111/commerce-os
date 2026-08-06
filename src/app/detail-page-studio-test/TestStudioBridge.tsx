"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

const MESSAGE_SOURCE = "new-product-detail-ai";
const SUBMIT_TYPE = "detail-page-test-submit";
const RESULT_SOURCE = "commerce-os-detail-page-test";
const RESULT_TYPE = "commerce-os-detail-page-test-result";

type IntakeState = {
  tone: "idle" | "progress" | "success" | "error";
  message: string;
  jobId?: string;
  reviewUrl?: string;
};

export function TestStudioBridge({ studioBaseUrl }: { studioBaseUrl: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<IntakeState>({
    tone: "idle",
    message: "테스트 스튜디오 입력을 기다리고 있습니다.",
  });
  const studio = useMemo(() => {
    try {
      const url = new URL(studioBaseUrl);
      url.searchParams.set("ops_embed", "1");
      if (typeof window !== "undefined") {
        url.searchParams.set("ops_origin", window.location.origin);
      }
      return { url: url.toString(), origin: url.origin };
    } catch {
      return null;
    }
  }, [studioBaseUrl]);

  useEffect(() => {
    if (!studio) return;
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== studio.origin ||
        event.source !== iframeRef.current?.contentWindow
      ) {
        return;
      }
      const payload = event.data as Record<string, unknown>;
      if (
        payload?.source !== MESSAGE_SOURCE ||
        payload?.type !== SUBMIT_TYPE ||
        typeof payload.requestId !== "string"
      ) {
        return;
      }
      const requestId = payload.requestId;
      setState({
        tone: "progress",
        message: "입력 이미지와 상품정보를 검수 작업 원장에 저장하고 있습니다.",
      });
      void (async () => {
        try {
          const response = await fetch("/api/detail-page-studio-test/jobs", {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            credentials: "same-origin",
            cache: "no-store",
            body: JSON.stringify(payload),
          });
          const body = (await response.json().catch(() => ({}))) as {
            ok?: boolean;
            job?: { jobId?: string };
            reviewUrl?: string;
            message?: string;
          };
          if (!response.ok || body.ok !== true || !body.job?.jobId) {
            throw new Error(
              body.message ||
                `상세페이지 테스트 작업 등록 실패 · HTTP ${response.status}`,
            );
          }
          const reviewUrl = body.reviewUrl || "/detail-page-ai-review";
          setState({
            tone: "success",
            message:
              body.message ||
              "상세페이지 AI 작업 검수 원장에 등록되었습니다.",
            jobId: body.job.jobId,
            reviewUrl,
          });
          postResult({
            requestId,
            ok: true,
            jobId: body.job.jobId,
            reviewUrl,
            message:
              body.message ||
              "상세페이지 AI 작업 검수 원장에 등록되었습니다.",
          });
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "상세페이지 테스트 작업을 등록하지 못했습니다.";
          setState({ tone: "error", message });
          postResult({ requestId, ok: false, message });
        }
      })();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [studio]);

  function postResult(input: {
    requestId: string;
    ok: boolean;
    jobId?: string;
    reviewUrl?: string;
    message: string;
  }) {
    if (!studio) return;
    iframeRef.current?.contentWindow?.postMessage(
      {
        source: RESULT_SOURCE,
        type: RESULT_TYPE,
        ...input,
      },
      studio.origin,
    );
  }

  if (!studio) {
    return (
      <section className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-950">
        <strong className="block text-base">테스트 스튜디오 주소 오류</strong>
        <p className="mt-2">
          NEXT_PUBLIC_DETAIL_PAGE_STUDIO_TEST_URL 환경변수 또는 기본 배포 주소를
          확인해야 합니다.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section
        className={`rounded-2xl border p-4 text-sm ${
          state.tone === "success"
            ? "border-emerald-200 bg-emerald-50 text-emerald-950"
            : state.tone === "error"
              ? "border-rose-200 bg-rose-50 text-rose-950"
              : state.tone === "progress"
                ? "border-blue-200 bg-blue-50 text-blue-950"
                : "border-slate-200 bg-white text-slate-700"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong className="block">
              {state.tone === "success"
                ? "검수 작업 등록 완료"
                : state.tone === "error"
                  ? "검수 작업 등록 실패"
                  : state.tone === "progress"
                    ? "작업 등록 중"
                    : "테스트 스튜디오 연결됨"}
            </strong>
            <p className="mt-1">{state.message}</p>
            {state.jobId ? (
              <p className="mt-1 break-all text-xs opacity-75">
                작업 ID · {state.jobId}
              </p>
            ) : null}
          </div>
          {state.reviewUrl ? (
            <Link
              href={state.reviewUrl}
              className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white hover:bg-emerald-800"
            >
              상세페이지 AI 작업 검수 열기
            </Link>
          ) : null}
        </div>
      </section>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <iframe
          ref={iframeRef}
          title="상세페이지 스튜디오 테스트버전"
          src={studio.url}
          className="h-[calc(100vh-220px)] min-h-[760px] w-full bg-slate-50"
          allow="clipboard-write"
        />
      </div>
    </div>
  );
}
