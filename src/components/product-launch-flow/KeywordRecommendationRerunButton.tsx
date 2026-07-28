"use client";

import { useEffect, useState } from "react";
import { PRODUCT_LAUNCH_SIMPLE_SESSION_KEY } from "@/lib/productLaunchSimpleSession";

type StoredSession = {
  version?: unknown;
  priceRequestId?: unknown;
  priceResult?: unknown;
  recommendationRequestId?: unknown;
  recommendationResult?: unknown;
  recommendationPolls?: unknown;
  directRequestId?: unknown;
  directResult?: unknown;
  updatedAt?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isCompletedRecommendation(value: unknown) {
  const result = object(value);
  const phase = text(result.phase).toLocaleLowerCase();
  const status = text(result.status).toLocaleLowerCase();
  return (
    phase === "artifact_ready" &&
    ["success", "skipped"].includes(status)
  );
}

function canRerunCurrentRecommendation(session: StoredSession | null) {
  if (!session || session.version !== 1) return false;
  if (!text(session.priceRequestId) && !session.priceResult) return false;
  if (text(session.directRequestId) || session.directResult) return false;
  return isCompletedRecommendation(session.recommendationResult);
}

export function KeywordRecommendationRerunButton() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(
        PRODUCT_LAUNCH_SIMPLE_SESSION_KEY,
      );
      const session = raw ? (JSON.parse(raw) as StoredSession) : null;
      setVisible(canRerunCurrentRecommendation(session));
    } catch {
      setVisible(false);
    }
  }, []);

  function rerun() {
    try {
      const raw = window.localStorage.getItem(
        PRODUCT_LAUNCH_SIMPLE_SESSION_KEY,
      );
      const session = raw ? (JSON.parse(raw) as StoredSession) : null;
      if (!canRerunCurrentRecommendation(session)) {
        setMessage(
          "현재 작업은 추천을 다시 만들 수 있는 상태가 아닙니다.",
        );
        setVisible(false);
        return;
      }
      const next = {
        ...session,
        recommendationRequestId: "",
        recommendationResult: null,
        recommendationPolls: 0,
        updatedAt: new Date().toISOString(),
      };
      window.localStorage.setItem(
        PRODUCT_LAUNCH_SIMPLE_SESSION_KEY,
        JSON.stringify(next),
      );
      window.location.reload();
    } catch {
      setMessage("추천 상태를 초기화하지 못했습니다. 페이지를 새로고침하세요.");
    }
  }

  if (!visible && !message) return null;

  return (
    <div className="mb-4 rounded-2xl border border-violet-200 bg-violet-50 p-4">
      {visible ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-black text-violet-950">
              현재 상품의 추천키워드를 새 엔진으로 다시 만들 수 있습니다.
            </p>
            <p className="mt-1 text-sm text-violet-800">
              상품업로드·가격설정·입력값은 유지하고 키워드 추천만 새로 실행합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={rerun}
            className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-black text-white"
          >
            현재 상품 추천 다시 만들기
          </button>
        </div>
      ) : null}
      {message ? (
        <p className="mt-2 text-sm font-bold text-red-700">{message}</p>
      ) : null}
    </div>
  );
}
