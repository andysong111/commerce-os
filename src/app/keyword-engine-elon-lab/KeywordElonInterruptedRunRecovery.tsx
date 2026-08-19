"use client";

import { useEffect, useState } from "react";

import {
  KEYWORD_ELON_V2_STORAGE_KEY,
  type KeywordElonLabSession,
} from "@/lib/keywordEngineElonLabV2";

const STALE_RECOVERY_MARKER = "keywordElon.step2StaleRecovery";
const INTERRUPTED_STATUSES = new Set(["discovering", "scoring", "title"]);

type RecoverySession = KeywordElonLabSession & {
  step3?: {
    status?: string;
  };
};

function readSession() {
  try {
    const raw = window.localStorage.getItem(KEYWORD_ELON_V2_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RecoverySession;
  } catch {
    return null;
  }
}

function writeSession(session: RecoverySession) {
  window.localStorage.setItem(KEYWORD_ELON_V2_STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent("keyword-elon-session-updated"));
}

function recoveryFingerprint(session: RecoverySession) {
  return [
    session.updatedAt,
    session.stage2Status,
    session.discovery?.candidates?.length ?? 0,
    session.scoredCandidates?.length ?? 0,
  ].join(":");
}

function findStep2Button() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => {
    const label = button.textContent || "";
    return label.includes("STEP 2") && (label.includes("키워드 대량 발굴") || label.includes("추가 발굴 다시 실행"));
  });
}

export default function KeywordElonInterruptedRunRecovery() {
  const [session, setSession] = useState<RecoverySession | null>(() =>
    typeof window === "undefined" ? null : readSession(),
  );

  useEffect(() => {
    const initial = readSession();
    if (initial && INTERRUPTED_STATUSES.has(initial.stage2Status)) {
      const fingerprint = recoveryFingerprint(initial);
      if (window.sessionStorage.getItem(STALE_RECOVERY_MARKER) !== fingerprint) {
        const hasSavedDiscovery = Boolean(initial.discovery?.candidates?.length);
        const recovered: RecoverySession = {
          ...initial,
          stage2Status: "error",
          lastMessage: hasSavedDiscovery
            ? "새로고침으로 STEP 2 실행이 중단되었습니다. 아래 `STEP 2 점수화 재개`를 누르면 저장된 후보와 점수 캐시를 재사용합니다."
            : "새로고침으로 STEP 2 후보수집이 중단되었습니다. 아래 `STEP 2 다시 실행`을 눌러 재개해 주세요.",
          updatedAt: new Date().toISOString(),
        };
        window.sessionStorage.setItem(STALE_RECOVERY_MARKER, fingerprint);
        writeSession(recovered);
        window.location.reload();
        return;
      }
    }

    const sync = () => setSession(readSession());
    const timer = window.setInterval(sync, 700);
    const listener = () => sync();
    window.addEventListener("keyword-elon-session-updated", listener);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keyword-elon-session-updated", listener);
    };
  }, []);

  if (!session?.identity || session.stage1Review !== "pass") return null;
  if (session.stage2Status === "done") return null;

  const hasSavedDiscovery = Boolean(session.discovery?.candidates?.length);
  const statusLabel = session.stage2Status === "error"
    ? "재개 대기"
    : session.stage2Status === "scoring"
      ? "점수화 중"
      : session.stage2Status === "discovering"
        ? "후보 수집 중"
        : session.stage2Status === "title"
          ? "상품명 생성 중"
          : "STEP 2 대기";

  function resumeStep2() {
    const button = findStep2Button();
    if (!button) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    button.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => button.click(), 300);
  }

  return (
    <section className="mx-auto mb-6 mt-[-1rem] max-w-[1500px] px-5 text-slate-900">
      <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-amber-800">STEP 3 · 잠금</div>
            <h2 className="mt-1 text-xl font-black">STEP 2 완료 후 통과키워드 추가발굴이 열립니다</h2>
            <p className="mt-2 text-sm leading-6 text-amber-950">
              현재 상태는 <b>{statusLabel}</b>입니다. STEP 3가 사라진 것이 아니라 STEP 2가 완료되지 않아 잠겨 있습니다.
              {hasSavedDiscovery ? ` 저장된 후보 ${session.discovery?.candidates.length ?? 0}개는 유지됩니다.` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={resumeStep2}
            className="rounded-xl bg-amber-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-amber-700"
          >
            {hasSavedDiscovery ? "STEP 2 점수화 재개" : "STEP 2 다시 실행"}
          </button>
        </div>
        <div className="mt-4 rounded-xl bg-white px-4 py-3 text-xs leading-6 text-slate-600">
          새 실험을 시작하지 마세요. 저장된 1688 원본·상품 정체성·후보·점수 캐시를 그대로 이어갑니다. STEP 2가 완료되면 이 잠금카드는 자동으로 사라지고 STEP 3 버튼이 표시됩니다.
        </div>
      </div>
    </section>
  );
}
