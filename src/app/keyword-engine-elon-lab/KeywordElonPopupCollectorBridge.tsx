"use client";

import { useEffect, useLayoutEffect, useState } from "react";

import {
  buildKeywordElonBrowserImportUrl,
  keywordElonSourceFromBrowserPayload,
  parseKeywordElonBrowserImportHash,
  parseKeywordElonBrowserLinkErrorHash,
  versionAtLeast,
  type KeywordElonBrowserImportPayload,
  type KeywordElonBrowserLinkErrorPayload,
} from "@/lib/keywordEngineElonLabBrowserImport";
import {
  KEYWORD_ELON_V2_STORAGE_KEY,
  emptyKeywordElonSession,
  parse1688OfferId,
  validate1688Url,
  type KeywordElonLabSession,
} from "@/lib/keywordEngineElonLabV2";
import {
  readSeoTitleLedgerLaunchContext,
  type SeoTitleLedgerLaunchContext,
} from "./SeoTitleLedgerLaunchHandoff";

const AUTO_RUN_KEY = "keywordEngineElonLab.autoRunToStep4.v1";
const AUDIT_RUN_KEY = "commerceOs.chinaLinkAudit.run.v1";
const POPUP_MESSAGE_SOURCE = "commerce-os-keyword-collector-popup";
const POPUP_WINDOW_NAME = "commerce-os-keyword-source-collector";
const REQUIRED_POPUP_COLLECTOR_VERSION = "0.1.3";
const ACTIVE_AUDIT_HEARTBEAT_MS = 90_000;

type ExtendedSession = KeywordElonLabSession & {
  step3?: unknown;
  step4?: unknown;
};

type AuditRunState = {
  status?: string;
  scope?: string;
  completed?: number;
  total?: number;
  heartbeatAt?: string;
  startedAt?: string;
};

type PopupMessage =
  | {
      source: typeof POPUP_MESSAGE_SOURCE;
      type: "success";
      payload: KeywordElonBrowserImportPayload;
    }
  | {
      source: typeof POPUP_MESSAGE_SOURCE;
      type: "error";
      payload: KeywordElonBrowserLinkErrorPayload;
    };

function readSession() {
  try {
    const raw = window.localStorage.getItem(KEYWORD_ELON_V2_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ExtendedSession) : null;
  } catch {
    return null;
  }
}

function writeSession(session: ExtendedSession) {
  window.localStorage.setItem(KEYWORD_ELON_V2_STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent("keyword-elon-session-updated"));
}

function readAuditRun() {
  try {
    const raw = window.localStorage.getItem(AUDIT_RUN_KEY);
    return raw ? (JSON.parse(raw) as AuditRunState) : null;
  } catch {
    return null;
  }
}

function activeAuditRun() {
  const state = readAuditRun();
  if (state?.status !== "running") return null;
  const heartbeat = Date.parse(state.heartbeatAt || state.startedAt || "");
  if (!Number.isFinite(heartbeat)) return null;
  return Date.now() - heartbeat <= ACTIVE_AUDIT_HEARTBEAT_MS ? state : null;
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

function writeSuccessfulCollection(payload: KeywordElonBrowserImportPayload) {
  const previous = readSession() ?? emptyKeywordElonSession();
  const source = keywordElonSourceFromBrowserPayload(payload);
  const next: ExtendedSession = {
    ...previous,
    source,
    identity: null,
    stage1Review: "pending",
    discovery: null,
    scoredCandidates: [],
    titleResult: null,
    stage2Status: "idle",
    stage2Round: 0,
    step3: undefined,
    step4: undefined,
    lastMessage: `Collector v${payload.collectorVersion || "?"} 새 수집창 완료 · 중국 상품명과 옵션 ${payload.supplierOptionGroups.length}개 그룹을 불러왔습니다.`,
    updatedAt: new Date().toISOString(),
  };
  writeSession(next);
}

function writeFailedCollection(payload: KeywordElonBrowserLinkErrorPayload) {
  const previous = readSession() ?? emptyKeywordElonSession();
  const label =
    payload.status === "link_error" ? "링크 오류" : "일시적 수집 실패";
  const message = `${label} · ${
    payload.errorMessage || payload.errorCode || "1688 화면을 사용할 수 없습니다."
  }`;
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
  writeSession(next);

  let marker: Record<string, unknown> = {};
  try {
    const raw = window.localStorage.getItem(AUTO_RUN_KEY);
    marker = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    marker = {};
  }
  window.localStorage.setItem(
    AUTO_RUN_KEY,
    JSON.stringify({
      ...marker,
      status: "error",
      url: payload.sourceUrl,
      requestedAt: String(
        marker.requestedAt || payload.checkedAt || new Date().toISOString(),
      ),
      message,
    }),
  );
  window.dispatchEvent(new StorageEvent("storage", { key: AUTO_RUN_KEY }));
}

async function reportFailedHealth(
  context: SeoTitleLedgerLaunchContext | null,
  payload: KeywordElonBrowserLinkErrorPayload,
) {
  if (
    !context?.launchItemId ||
    !sameSourceUrl(context.sourceUrl, payload.sourceUrl)
  ) {
    return;
  }
  await fetch("/api/product-launch-tracker/china-link-health", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    keepalive: true,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "record_batch",
      results: [
        {
          itemId: context.launchItemId,
          url: payload.sourceUrl,
          status: payload.status,
          errorCode: payload.errorCode,
          errorMessage: payload.errorMessage,
          finalUrl: payload.finalUrl,
          collectorVersion: payload.collectorVersion,
          detectedText: payload.detectedText,
          checkedAt: payload.checkedAt || new Date().toISOString(),
          source: "seo_bulk_cloud_popup",
        },
      ],
    }),
  });
}

function popupInput(button: HTMLButtonElement) {
  const section = button.closest("section");
  const input = section?.querySelector(
    'input[placeholder*="1688"], input[value*="1688.com"]',
  );
  return input instanceof HTMLInputElement ? input : null;
}

function popupCollectorVersion() {
  return (
    document.documentElement.dataset.commerceOsKeywordLabCollectorVersion || ""
  );
}

function isCollectorActionButton(button: HTMLButtonElement) {
  const label = String(button.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
  return label === "FINAL RESULT 받기" || label === "1688 브라우저 자동수집";
}

function armAutoRun(url: string) {
  window.localStorage.setItem(
    AUTO_RUN_KEY,
    JSON.stringify({
      status: "armed",
      url,
      requestedAt: new Date().toISOString(),
      message: "새 수집창에서 1688 원본 수집 대기",
    }),
  );
  window.dispatchEvent(new StorageEvent("storage", { key: AUTO_RUN_KEY }));
}

export default function KeywordElonPopupCollectorBridge() {
  const [notice, setNotice] = useState("");

  useLayoutEffect(() => {
    if (!window.opener || window.opener.closed) return;
    let message: PopupMessage | null = null;
    try {
      const success = parseKeywordElonBrowserImportHash(window.location.hash);
      if (success) {
        message = {
          source: POPUP_MESSAGE_SOURCE,
          type: "success",
          payload: success,
        };
      } else {
        const failure = parseKeywordElonBrowserLinkErrorHash(window.location.hash);
        if (failure) {
          message = {
            source: POPUP_MESSAGE_SOURCE,
            type: "error",
            payload: failure,
          };
        }
      }
    } catch {
      message = null;
    }
    if (!message) return;

    window.history.replaceState(
      {},
      document.title,
      `${window.location.pathname}${window.location.search}`,
    );
    window.opener.postMessage(message, window.location.origin);
    window.opener.focus();
    const closeTimer = window.setTimeout(() => window.close(), 120);
    return () => window.clearTimeout(closeTimer);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent<PopupMessage>) => {
      if (
        event.origin !== window.location.origin ||
        event.data?.source !== POPUP_MESSAGE_SOURCE
      ) {
        return;
      }
      if (event.data.type === "success") {
        writeSuccessfulCollection(event.data.payload);
        setNotice(
          "새 수집창에서 1688 원본 수집을 완료했습니다. 이 화면에서 STEP 1~4 자동 실행을 이어갑니다.",
        );
        return;
      }

      writeFailedCollection(event.data.payload);
      setNotice(
        event.data.payload.status === "link_error"
          ? `고정링크 오류로 수집을 중단했습니다. ${event.data.payload.errorMessage}`
          : `1688 화면을 읽지 못해 이번 실행을 보류했습니다. ${event.data.payload.errorMessage}`,
      );
      void reportFailedHealth(
        readSeoTitleLedgerLaunchContext(),
        event.data.payload,
      ).catch(() => null);
    };

    const onClick = (event: MouseEvent) => {
      const button =
        event.target instanceof Element
          ? event.target.closest("button")
          : null;
      if (!(button instanceof HTMLButtonElement) || !isCollectorActionButton(button)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const audit = activeAuditRun();
      if (audit) {
        const progress =
          Number.isFinite(Number(audit.completed)) &&
          Number.isFinite(Number(audit.total)) &&
          Number(audit.total) > 0
            ? ` · ${Number(audit.completed)}/${Number(audit.total)}`
            : "";
        setNotice(
          `고정링크 전체재검사가 진행 중입니다${progress}. 1688 동시 접속 충돌을 막기 위해 검사 완료 또는 중단 후 FINAL RESULT를 실행하세요.`,
        );
        return;
      }

      const collectorVersion = popupCollectorVersion();
      if (
        !versionAtLeast(
          collectorVersion,
          REQUIRED_POPUP_COLLECTOR_VERSION,
        )
      ) {
        setNotice(
          `Keyword Lab Collector v${REQUIRED_POPUP_COLLECTOR_VERSION} 이상이 필요합니다. 새 ZIP으로 업데이트한 뒤 Ctrl+F5 하세요.`,
        );
        return;
      }

      const input = popupInput(button);
      const url = input?.value.trim() || "";
      if (!validate1688Url(url)) {
        setNotice("1688.com 상품 링크를 입력해 주세요.");
        return;
      }

      const returnUrl = new URL(
        "/keyword-engine-elon-lab",
        window.location.origin,
      ).toString();
      let collectionUrl = "";
      try {
        collectionUrl = buildKeywordElonBrowserImportUrl(url, returnUrl);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "1688 새 수집창 주소를 만들지 못했습니다.",
        );
        return;
      }

      const popup = window.open(
        "about:blank",
        POPUP_WINDOW_NAME,
        "popup=yes,width=1280,height=900,left=80,top=40,resizable=yes,scrollbars=yes",
      );
      if (!popup) {
        setNotice(
          "1688 새 수집창이 차단됐습니다. Ops Center의 팝업을 허용한 뒤 다시 실행하세요.",
        );
        return;
      }

      const autoRun = String(button.textContent || "").includes("FINAL RESULT");
      if (autoRun) armAutoRun(url);

      try {
        popup.location.replace(collectionUrl);
        setNotice(
          "1688 원본을 새 수집창에서 확인하고 있습니다. 현재 SEO 대량등록 클라우드 화면은 그대로 유지됩니다.",
        );
      } catch (error) {
        popup.close();
        if (autoRun) window.localStorage.removeItem(AUTO_RUN_KEY);
        setNotice(
          error instanceof Error
            ? error.message
            : "1688 새 수집창을 시작하지 못했습니다.",
        );
      }
    };

    window.addEventListener("message", onMessage);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  if (!notice || (typeof window !== "undefined" && window.opener)) return null;
  const warning = /오류|보류|필요|차단|진행 중/.test(notice);
  return (
    <section className="mx-auto mt-3 max-w-[1500px] px-5 text-slate-900">
      <div
        className={`rounded-xl border px-4 py-3 text-sm font-black ${
          warning
            ? "border-amber-300 bg-amber-50 text-amber-950"
            : "border-sky-300 bg-sky-50 text-sky-950"
        }`}
      >
        {notice}
      </div>
    </section>
  );
}
