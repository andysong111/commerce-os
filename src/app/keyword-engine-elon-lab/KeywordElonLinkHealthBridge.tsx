"use client";

import { useEffect, useState } from "react";

import {
  parseKeywordElonBrowserLinkErrorHash,
  type KeywordElonBrowserLinkErrorPayload,
} from "@/lib/keywordEngineElonLabBrowserImport";
import {
  KEYWORD_ELON_V2_STORAGE_KEY,
  emptyKeywordElonSession,
  parse1688OfferId,
  type KeywordElonLabSession,
} from "@/lib/keywordEngineElonLabV2";
import {
  readSeoTitleLedgerLaunchContext,
  type SeoTitleLedgerLaunchContext,
} from "./SeoTitleLedgerLaunchHandoff";

const AUTO_RUN_KEY = "keywordEngineElonLab.autoRunToStep4.v1";
const REPORTED_HEALTH_KEY = "commerceOs.chinaLinkHealth.reported.v1";

type ExtendedSession = KeywordElonLabSession & {
  step3?: unknown;
  step4?: unknown;
};

type Notice = {
  status: "link_error" | "temporary_error";
  message: string;
  code: string;
};

function readSession() {
  try {
    const raw = window.localStorage.getItem(KEYWORD_ELON_V2_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ExtendedSession) : null;
  } catch {
    return null;
  }
}

function sameSourceUrl(left: string, right: string) {
  const leftOffer = parse1688OfferId(left);
  const rightOffer = parse1688OfferId(right);
  if (leftOffer && rightOffer) return leftOffer === rightOffer;
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return (
      leftUrl.hostname.toLowerCase() === rightUrl.hostname.toLowerCase() &&
      leftUrl.pathname === rightUrl.pathname
    );
  } catch {
    return left.trim() === right.trim();
  }
}

function healthFingerprint(input: {
  itemId: string;
  url: string;
  status: string;
  checkedAt: string;
  errorCode?: string;
}) {
  return [
    input.itemId,
    input.url,
    input.status,
    input.checkedAt,
    input.errorCode || "",
  ].join("|");
}

function readReportedFingerprints() {
  try {
    const raw = window.localStorage.getItem(REPORTED_HEALTH_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []);
  } catch {
    return new Set<string>();
  }
}

function rememberFingerprint(fingerprint: string) {
  const values = [...readReportedFingerprints(), fingerprint].slice(-200);
  window.localStorage.setItem(REPORTED_HEALTH_KEY, JSON.stringify(values));
}

async function reportHealth(
  context: SeoTitleLedgerLaunchContext | null,
  input: {
    url: string;
    status: "ok" | "link_error" | "temporary_error";
    errorCode?: string;
    errorMessage?: string;
    finalUrl?: string;
    collectorVersion?: string;
    detectedText?: string;
    checkedAt: string;
  },
) {
  if (!context?.launchItemId || !sameSourceUrl(context.sourceUrl, input.url)) {
    return;
  }
  const fingerprint = healthFingerprint({
    itemId: context.launchItemId,
    url: input.url,
    status: input.status,
    checkedAt: input.checkedAt,
    errorCode: input.errorCode,
  });
  if (readReportedFingerprints().has(fingerprint)) return;

  const response = await fetch("/api/product-launch-tracker/china-link-health", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "record_batch",
      results: [
        {
          itemId: context.launchItemId,
          url: input.url,
          status: input.status,
          errorCode: input.errorCode || "",
          errorMessage: input.errorMessage || "",
          finalUrl: input.finalUrl || input.url,
          collectorVersion: input.collectorVersion || "",
          detectedText: input.detectedText || "",
          checkedAt: input.checkedAt,
          source: "seo_bulk_cloud",
        },
      ],
    }),
  });
  if (response.ok) rememberFingerprint(fingerprint);
}

function writeLinkFailure(payload: KeywordElonBrowserLinkErrorPayload) {
  const previous = readSession() ?? emptyKeywordElonSession();
  const label =
    payload.status === "link_error" ? "링크 오류" : "일시적 수집 실패";
  const message = `${label} · ${payload.errorMessage || payload.errorCode || "1688 화면을 사용할 수 없습니다."}`;
  const next: ExtendedSession = {
    ...previous,
    source: {
      ...previous.source,
      url: payload.sourceUrl,
      offerId: parse1688OfferId(payload.sourceUrl),
      autoStatus: "failed",
      chineseTitle: "",
      optionText: "",
      supportingText: "",
      warnings: [message],
      collectedAt: payload.checkedAt || new Date().toISOString(),
    },
    identity: null,
    stage1Review: "pending",
    discovery: null,
    scoredCandidates: [],
    titleResult: null,
    stage2Status: "error",
    stage2Round: 0,
    step3: undefined,
    step4: undefined,
    lastMessage: message,
    updatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(KEYWORD_ELON_V2_STORAGE_KEY, JSON.stringify(next));

  const markerRaw = window.localStorage.getItem(AUTO_RUN_KEY);
  let marker: Record<string, unknown> = {};
  try {
    marker = markerRaw ? (JSON.parse(markerRaw) as Record<string, unknown>) : {};
  } catch {
    marker = {};
  }
  window.localStorage.setItem(
    AUTO_RUN_KEY,
    JSON.stringify({
      ...marker,
      status: "error",
      url: payload.sourceUrl,
      requestedAt: String(marker.requestedAt || payload.checkedAt || new Date().toISOString()),
      message,
    }),
  );
  window.dispatchEvent(new CustomEvent("keyword-elon-session-updated"));
  window.dispatchEvent(new StorageEvent("storage", { key: AUTO_RUN_KEY }));
}

export default function KeywordElonLinkHealthBridge() {
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let cancelled = false;

    const handleSuccessfulCollection = () => {
      const session = readSession();
      const context = readSeoTitleLedgerLaunchContext();
      if (
        !session ||
        !context?.launchItemId ||
        !["success", "partial"].includes(session.source.autoStatus) ||
        !session.source.url ||
        !sameSourceUrl(context.sourceUrl, session.source.url)
      ) {
        return;
      }
      const checkedAt = session.source.collectedAt || new Date().toISOString();
      void reportHealth(context, {
        url: session.source.url,
        status: "ok",
        finalUrl: session.source.url,
        collectorVersion:
          document.documentElement.dataset
            .commerceOsKeywordLabCollectorVersion || "",
        checkedAt,
      }).catch(() => null);
    };

    try {
      const payload = parseKeywordElonBrowserLinkErrorHash(window.location.hash);
      if (payload) {
        writeLinkFailure(payload);
        setNotice({
          status: payload.status,
          message:
            payload.errorMessage ||
            (payload.status === "link_error"
              ? "1688 고정링크가 단종·삭제·폐업 상태입니다."
              : "1688 로그인·보안검증·일시적 로딩 문제로 수집하지 못했습니다."),
          code: payload.errorCode,
        });
        void reportHealth(readSeoTitleLedgerLaunchContext(), {
          url: payload.sourceUrl,
          status: payload.status,
          errorCode: payload.errorCode,
          errorMessage: payload.errorMessage,
          finalUrl: payload.finalUrl,
          collectorVersion: payload.collectorVersion,
          detectedText: payload.detectedText,
          checkedAt: payload.checkedAt || new Date().toISOString(),
        }).catch(() => null);
        window.name = "";
        window.history.replaceState(
          {},
          document.title,
          `${window.location.pathname}${window.location.search}`,
        );
      }
    } catch (error) {
      setNotice({
        status: "temporary_error",
        message:
          error instanceof Error
            ? error.message
            : "1688 링크 오류 결과를 해석하지 못했습니다.",
        code: "invalid_collector_result",
      });
    }

    const onSessionUpdated = () => {
      if (!cancelled) handleSuccessfulCollection();
    };
    window.addEventListener("keyword-elon-session-updated", onSessionUpdated);
    window.addEventListener("storage", onSessionUpdated);
    const initial = window.setTimeout(handleSuccessfulCollection, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.removeEventListener("keyword-elon-session-updated", onSessionUpdated);
      window.removeEventListener("storage", onSessionUpdated);
    };
  }, []);

  if (!notice) return null;
  const permanent = notice.status === "link_error";
  return (
    <section className="mx-auto mt-3 max-w-[1500px] px-5 text-slate-900">
      <div
        className={`rounded-2xl border-2 px-5 py-4 shadow-sm ${
          permanent
            ? "border-rose-300 bg-rose-50 text-rose-950"
            : "border-amber-300 bg-amber-50 text-amber-950"
        }`}
      >
        <div className="text-xs font-black uppercase tracking-[0.15em]">
          {permanent ? "LINK ERROR · EXECUTION STOPPED" : "TEMPORARY 1688 ERROR"}
        </div>
        <div className="mt-1 text-lg font-black">
          {permanent ? "고정링크 오류로 STEP 실행 실패" : "일시적 접속 문제로 STEP 실행 보류"}
        </div>
        <p className="mt-1 text-sm font-bold leading-6">
          {notice.message}
          {notice.code ? ` · ${notice.code}` : ""}
        </p>
      </div>
    </section>
  );
}
