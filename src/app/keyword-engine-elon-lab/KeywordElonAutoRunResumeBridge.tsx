"use client";

import { useEffect, useState } from "react";

import {
  KEYWORD_ELON_V2_STORAGE_KEY,
  parse1688OfferId,
  type KeywordElonLabSession,
} from "@/lib/keywordEngineElonLabV2";

const AUTO_RUN_KEY = "keywordEngineElonLab.autoRunToStep4.v1";
const RUNNING_STALE_MS = 2_500;

type AutoRunMarker = {
  status?: "armed" | "running" | "error";
  url?: string;
  requestedAt?: string;
  message?: string;
};

type ExtendedSession = KeywordElonLabSession & {
  step3?: unknown;
  step4?: unknown;
};

function readMarker() {
  try {
    const raw = window.localStorage.getItem(AUTO_RUN_KEY);
    return raw ? JSON.parse(raw) as AutoRunMarker : null;
  } catch {
    return null;
  }
}

function writeMarker(marker: AutoRunMarker) {
  window.localStorage.setItem(AUTO_RUN_KEY, JSON.stringify(marker));
}

function readSession() {
  try {
    const raw = window.localStorage.getItem(KEYWORD_ELON_V2_STORAGE_KEY);
    return raw ? JSON.parse(raw) as ExtendedSession : null;
  } catch {
    return null;
  }
}

function same1688Offer(markerUrl: string, session: ExtendedSession) {
  const markerOfferId = parse1688OfferId(markerUrl);
  const sessionOfferId = session.source.offerId || parse1688OfferId(session.source.url);
  if (markerOfferId && sessionOfferId) return markerOfferId === sessionOfferId;

  try {
    const marker = new URL(markerUrl);
    const source = new URL(session.source.url);
    return marker.hostname === source.hostname && marker.pathname === source.pathname;
  } catch {
    return false;
  }
}

function markerAgeMs(marker: AutoRunMarker) {
  const started = Date.parse(marker.requestedAt || "");
  return Number.isFinite(started) ? Math.max(0, Date.now() - started) : Number.POSITIVE_INFINITY;
}

export default function KeywordElonAutoRunResumeBridge() {
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const reconcile = () => {
      const marker = readMarker();
      if (!marker?.url) return;
      const session = readSession();
      if (!session) return;
      const sourceReady = Boolean(session.source.chineseTitle.trim() || session.source.optionText.trim());
      if (!sourceReady || !same1688Offer(marker.url, session)) return;

      const markerOfferId = parse1688OfferId(marker.url);
      if (session.source.url !== marker.url || (markerOfferId && session.source.offerId !== markerOfferId)) {
        const next: ExtendedSession = {
          ...session,
          source: {
            ...session.source,
            url: marker.url,
            offerId: markerOfferId || session.source.offerId,
          },
          lastMessage: "원클릭 수집 복귀 확인 · 같은 1688 offerId로 자동 STEP 4 실행을 이어갑니다.",
          updatedAt: new Date().toISOString(),
        };
        window.localStorage.setItem(KEYWORD_ELON_V2_STORAGE_KEY, JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("keyword-elon-session-updated"));
      }

      if (marker.status === "error") {
        setNotice(`원클릭 실행 오류 · ${marker.message || "오류 원인을 확인하지 못했습니다."}`);
        return;
      }

      if (marker.status === "running" && markerAgeMs(marker) >= RUNNING_STALE_MS) {
        writeMarker({
          ...marker,
          status: "armed",
          message: "브라우저 복귀 후 원클릭 실행을 자동 재개합니다.",
        });
        setNotice("원클릭 자동 실행을 복구했습니다. STEP 1부터 STEP 4까지 이어서 진행합니다.");
        return;
      }

      if (marker.status === "armed") {
        setNotice("1688 수집 완료 · 자동 STEP 1~4 실행 대기 중입니다.");
      }
    };

    reconcile();
    const timer = window.setInterval(reconcile, 250);
    return () => window.clearInterval(timer);
  }, []);

  if (!notice) return null;
  const isError = notice.includes("오류");
  return (
    <section className="mx-auto mt-3 max-w-[1500px] px-5 text-slate-900">
      <div className={`rounded-xl border px-4 py-3 text-sm font-black ${isError ? "border-rose-300 bg-rose-50 text-rose-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
        {notice}
      </div>
    </section>
  );
}
