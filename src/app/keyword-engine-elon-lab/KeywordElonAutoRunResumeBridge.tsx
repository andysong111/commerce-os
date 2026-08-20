"use client";

import { useEffect } from "react";

import {
  KEYWORD_ELON_V2_STORAGE_KEY,
  parse1688OfferId,
  type KeywordElonLabSession,
} from "@/lib/keywordEngineElonLabV2";

const AUTO_RUN_KEY = "keywordEngineElonLab.autoRunToStep4.v1";

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

export default function KeywordElonAutoRunResumeBridge() {
  useEffect(() => {
    const reconcile = () => {
      const marker = readMarker();
      if (!marker || marker.status !== "armed" || !marker.url) return;
      const session = readSession();
      if (!session) return;
      const sourceReady = Boolean(session.source.chineseTitle.trim() || session.source.optionText.trim());
      if (!sourceReady || !same1688Offer(marker.url, session)) return;
      if (session.source.url === marker.url) return;

      const markerOfferId = parse1688OfferId(marker.url);
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
    };

    reconcile();
    const timer = window.setInterval(reconcile, 250);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
