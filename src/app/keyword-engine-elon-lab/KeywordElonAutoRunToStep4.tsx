"use client";

import { useEffect, useRef, useState } from "react";

import {
  buildKeywordElonBrowserImportUrl,
  versionAtLeast,
  KEYWORD_ELON_REQUIRED_COLLECTOR_VERSION,
} from "@/lib/keywordEngineElonLabBrowserImport";
import {
  KEYWORD_ELON_V2_STORAGE_KEY,
  compactKeywordElonKey,
  uniqueKeywordElonCanonical,
  validate1688Url,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonIdentity,
  type KeywordElonLabSession,
  type KeywordElonTitleResult,
} from "@/lib/keywordEngineElonLabV2";
import {
  mergeKeywordElonCandidates,
  mergeKeywordElonDiscovery,
} from "@/lib/keywordEngineElonLabV2Merge";
import type { KeywordElonStep4FilterResult } from "@/lib/keywordEngineElonLabV2Step4";

const AUTO_RUN_KEY = "keywordEngineElonLab.autoRunToStep4.v1";
const CUSTOM_BLOCKED_STORAGE_KEY = "keywordEngineElonLab.step4.customBlockedTerms.v1";

type ApiRecord = Record<string, unknown> & { ok?: boolean; error?: unknown; errorStage?: unknown };
type Step3Meta = {
  status: "idle" | "discovering" | "scoring" | "title" | "done" | "error";
  round: number;
  seedKeywords: string[];
  newCandidateCount: number;
  newPassingCount: number;
  totalPassingCount: number;
  lastMessage: string;
  updatedAt: string;
};
type Step4Meta = KeywordElonStep4FilterResult & {
  status: "running" | "done" | "error";
  inputFingerprint: string;
  customBlockedTerms: string[];
  titleResult: KeywordElonTitleResult | null;
  lastMessage: string;
  updatedAt: string;
};
type ExtendedSession = KeywordElonLabSession & { step3?: Step3Meta; step4?: Step4Meta };
type AutoRunMarker = {
  status: "armed" | "running" | "error";
  url: string;
  requestedAt: string;
  message?: string;
};
type ExpansionResponse = ApiRecord & {
  discovery: KeywordElonDiscovery;
  seedKeywords: string[];
  round: number;
  newCandidateCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function requestLab<T extends ApiRecord>(body: Record<string, unknown>) {
  const response = await fetch("/api/keyword-engine-elon-lab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const raw = await response.text();
  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`서버가 JSON이 아닌 응답을 반환했습니다. HTTP ${response.status}: ${raw.slice(0, 220)}`);
  }
  if (!isRecord(payload)) throw new Error(`서버 응답 형식이 올바르지 않습니다. HTTP ${response.status}`);
  if (!response.ok || payload.ok !== true) {
    const stage = typeof payload.errorStage === "string" ? payload.errorStage : "request";
    const message = typeof payload.error === "string" ? payload.error : `요청 실패 · HTTP ${response.status}`;
    throw new Error(message.startsWith("[") ? message : `[${stage}] ${message}`);
  }
  return payload as T;
}

function readSession() {
  try {
    const raw = window.localStorage.getItem(KEYWORD_ELON_V2_STORAGE_KEY);
    return raw ? JSON.parse(raw) as ExtendedSession : null;
  } catch {
    return null;
  }
}

function writeSession(session: ExtendedSession) {
  window.localStorage.setItem(KEYWORD_ELON_V2_STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent("keyword-elon-session-updated"));
}

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

function readCustomBlockedTerms() {
  try {
    const raw = window.localStorage.getItem(CUSTOM_BLOCKED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return uniqueKeywordElonCanonical(Array.isArray(parsed) ? parsed : [], 120).filter((term) => term.length >= 2);
  } catch {
    return [];
  }
}

function passingRows(session: ExtendedSession) {
  return session.scoredCandidates
    .filter((row) => row.safetyPass && row.qualityScore >= session.cutoff)
    .sort((a, b) => b.qualityScore - a.qualityScore || (b.totalSearch ?? -1) - (a.totalSearch ?? -1));
}

function seedRows(session: ExtendedSession) {
  return uniqueKeywordElonCanonical(
    passingRows(session).map((row) => row.searchKeyword || row.searchKey || row.keyword),
    8,
  );
}

function step3Meta(
  previous: Step3Meta | undefined,
  patch: Partial<Step3Meta>,
): Step3Meta {
  return {
    status: previous?.status ?? "idle",
    round: previous?.round ?? 0,
    seedKeywords: previous?.seedKeywords ?? [],
    newCandidateCount: previous?.newCandidateCount ?? 0,
    newPassingCount: previous?.newPassingCount ?? 0,
    totalPassingCount: previous?.totalPassingCount ?? 0,
    lastMessage: previous?.lastMessage ?? "",
    updatedAt: new Date().toISOString(),
    ...patch,
  };
}

function fingerprint(candidates: KeywordElonCandidate[], cutoff: number, customTerms: string[]) {
  return [
    `auto:1`,
    `cutoff:${cutoff}`,
    `custom:${customTerms.join(",")}`,
    ...candidates.map((row) => `${compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword)}:${row.qualityScore.toFixed(2)}`),
  ].join("|");
}

export default function KeywordElonAutoRunToStep4() {
  const [url, setUrl] = useState("");
  const [collectorVersion, setCollectorVersion] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const runningRef = useRef(false);

  useEffect(() => {
    const detect = () => {
      const version = document.documentElement.dataset.commerceOsKeywordLabCollectorVersion || "";
      setCollectorVersion(version);
    };
    detect();
    const listener = () => detect();
    document.addEventListener("commerce-os-keyword-lab-collector-ready", listener);
    const timer = window.setInterval(detect, 600);
    const stop = window.setTimeout(() => window.clearInterval(timer), 6000);
    return () => {
      document.removeEventListener("commerce-os-keyword-lab-collector-ready", listener);
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (cancelled || runningRef.current) return;
      const marker = readMarker();
      if (!marker || marker.status !== "armed") return;
      const session = readSession();
      if (!session) return;
      const sameUrl = compactKeywordElonKey(session.source.url) === compactKeywordElonKey(marker.url);
      const sourceReady = Boolean(session.source.chineseTitle.trim() || session.source.optionText.trim());
      if (!sameUrl || !sourceReady) return;
      runningRef.current = true;
      writeMarker({ ...marker, status: "running", message: "수집 완료 · STEP 1 자동분석 시작" });
      void runPipeline(session, marker).finally(() => {
        runningRef.current = false;
      });
    }, 700);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const collectorReady = versionAtLeast(collectorVersion, KEYWORD_ELON_REQUIRED_COLLECTOR_VERSION);

  function startAutoRun() {
    const normalized = url.trim();
    setError("");
    if (!validate1688Url(normalized)) {
      setError("1688.com 상품 링크를 입력해 주세요.");
      return;
    }
    if (!collectorReady) {
      setError(`Keyword Lab Collector v${KEYWORD_ELON_REQUIRED_COLLECTOR_VERSION} 이상이 필요합니다.`);
      return;
    }
    const marker: AutoRunMarker = {
      status: "armed",
      url: normalized,
      requestedAt: new Date().toISOString(),
      message: "1688 원본 수집 대기",
    };
    writeMarker(marker);
    setProgress("1688 브라우저 수집을 시작합니다. 수집 후 이 화면으로 돌아오면 STEP 4까지 자동 진행됩니다.");
    const returnUrl = new URL("/keyword-engine-elon-lab", window.location.origin).toString();
    window.location.assign(buildKeywordElonBrowserImportUrl(normalized, returnUrl));
  }

  async function runPipeline(initial: ExtendedSession, marker: AutoRunMarker) {
    try {
      const source = initial.source;
      setError("");
      setProgress("일괄 실행 1/6 · STEP 1 상품 정체성 분석 중…");
      const identityResponse = await requestLab<ApiRecord & { identity: KeywordElonIdentity }>({
        action: "analyze_identity",
        source,
      });
      let current: ExtendedSession = {
        ...initial,
        identity: identityResponse.identity,
        stage1Review: "pass",
        discovery: null,
        scoredCandidates: [],
        titleResult: null,
        stage2Status: "idle",
        stage2Round: 0,
        step3: undefined,
        step4: undefined,
        lastMessage: "일괄 실행 · STEP 1 자동 통과",
        updatedAt: new Date().toISOString(),
      };
      writeSession(current);

      setProgress("일괄 실행 2/6 · STEP 2 round 1 시장어 대량 발굴 중…");
      const discovered = await requestLab<ApiRecord & { discovery: KeywordElonDiscovery }>({
        action: "discover_keywords",
        source,
        identity: identityResponse.identity,
      });
      current = {
        ...current,
        discovery: discovered.discovery,
        stage2Status: "scoring",
        lastMessage: `일괄 실행 · STEP 2 round 1 후보 ${discovered.discovery.candidates.length}개 점수화 중`,
        updatedAt: new Date().toISOString(),
      };
      writeSession(current);

      const scored = await requestLab<ApiRecord & { candidates: KeywordElonCandidate[] }>({
        action: "score_keywords",
        source,
        identity: identityResponse.identity,
        discovery: discovered.discovery,
      });
      current = {
        ...current,
        scoredCandidates: scored.candidates,
        stage2Status: "done",
        stage2Round: 1,
        lastMessage: `일괄 실행 · STEP 2 round 1 완료 · 통과 ${scored.candidates.filter((row) => row.safetyPass && row.qualityScore >= current.cutoff).length}개`,
        updatedAt: new Date().toISOString(),
      };
      writeSession(current);

      for (let round = 1; round <= 3; round += 1) {
        setProgress(`일괄 실행 ${round + 2}/6 · STEP 3 round ${round}/3 자동 확장 중…`);
        const seeds = seedRows(current);
        if (!seeds.length) throw new Error("STEP 2 통과 키워드가 없어 STEP 3 자동 확장을 계속할 수 없습니다.");
        const expanded = await requestLab<ExpansionResponse>({
          action: "expand_from_passing",
          identity: current.identity,
          seedKeywords: seeds,
          existingDiscovery: current.discovery,
          existingCandidates: current.scoredCandidates,
          round,
        });
        if (expanded.newCandidateCount && expanded.discovery.candidates.length) {
          const previousKeys = new Set(current.scoredCandidates.map((row) => compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword)));
          const roundScored = await requestLab<ApiRecord & { candidates: KeywordElonCandidate[] }>({
            action: "score_keywords",
            source,
            identity: current.identity,
            discovery: expanded.discovery,
          });
          const mergedCandidates = mergeKeywordElonCandidates(current.scoredCandidates, roundScored.candidates);
          const mergedDiscovery = mergeKeywordElonDiscovery(current.discovery, expanded.discovery);
          const newlyPassed = roundScored.candidates.filter(
            (row) => row.safetyPass && row.qualityScore >= current.cutoff && !previousKeys.has(compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword)),
          ).length;
          current = {
            ...current,
            discovery: mergedDiscovery,
            scoredCandidates: mergedCandidates,
            step3: step3Meta(current.step3, {
              status: "done",
              round,
              seedKeywords: expanded.seedKeywords,
              newCandidateCount: expanded.newCandidateCount,
              newPassingCount: newlyPassed,
              totalPassingCount: passingRows({ ...current, scoredCandidates: mergedCandidates }).length,
              lastMessage: `round ${round} 완료 · 신규 후보 ${expanded.newCandidateCount}개 · 신규 통과 ${newlyPassed}개`,
            }),
            lastMessage: `일괄 실행 · STEP 3 round ${round}/3 완료`,
            updatedAt: new Date().toISOString(),
          };
        } else {
          current = {
            ...current,
            step3: step3Meta(current.step3, {
              status: "done",
              round,
              seedKeywords: expanded.seedKeywords?.length ? expanded.seedKeywords : seeds,
              newCandidateCount: 0,
              newPassingCount: 0,
              totalPassingCount: passingRows(current).length,
              lastMessage: `round ${round} 완료 · 신규 후보 없음`,
            }),
            lastMessage: `일괄 실행 · STEP 3 round ${round}/3 완료 · 신규 후보 없음`,
            updatedAt: new Date().toISOString(),
          };
        }
        writeSession(current);
      }

      setProgress("일괄 실행 6/6 · STEP 4 위험·사용자 금지키워드 제거 중…");
      const finalCandidates = passingRows(current);
      const customBlockedTerms = readCustomBlockedTerms();
      if (!finalCandidates.length) {
        const emptyResult: KeywordElonStep4FilterResult = {
          inputCount: 0,
          allowedCount: 0,
          removedCount: 0,
          allowedKeys: [],
          removedKeys: [],
          decisions: [],
          aiConfigured: true,
          kiprisConfigured: false,
          kiprisCheckedCount: 0,
          kiprisMatchedCount: 0,
          warnings: ["STEP4_NO_PASSING_KEYWORD"],
        };
        current = {
          ...current,
          titleResult: null,
          step4: {
            ...emptyResult,
            status: "done",
            inputFingerprint: fingerprint(finalCandidates, current.cutoff, customBlockedTerms),
            customBlockedTerms,
            titleResult: null,
            lastMessage: "STEP 4 완료 · 최종 통과 키워드가 없어 수동 검토 필요",
            updatedAt: new Date().toISOString(),
          },
          lastMessage: "일괄 실행 완료 · 최종 통과 키워드가 없어 수동 검토가 필요합니다.",
          updatedAt: new Date().toISOString(),
        };
      } else {
        const filtered = await requestLab<ApiRecord & { result: KeywordElonStep4FilterResult }>({
          action: "filter_prohibited_keywords",
          identity: current.identity,
          candidates: finalCandidates,
          customBlockedTerms,
        });
        const allowedSet = new Set(filtered.result.allowedKeys);
        const allowedCandidates = finalCandidates.filter(
          (row) => allowedSet.has(compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword)),
        );
        let titleResult: KeywordElonTitleResult | null = null;
        if (allowedCandidates.length) {
          const titled = await requestLab<ApiRecord & { titleResult: KeywordElonTitleResult }>({
            action: "generate_title",
            source,
            identity: current.identity,
            candidates: allowedCandidates,
            cutoff: current.cutoff,
          });
          titleResult = titled.titleResult;
        }
        current = {
          ...current,
          titleResult,
          step4: {
            ...filtered.result,
            status: "done",
            inputFingerprint: fingerprint(finalCandidates, current.cutoff, customBlockedTerms),
            customBlockedTerms,
            titleResult,
            lastMessage: `STEP 4 완료 · ${filtered.result.removedCount}개 제거 · 최종 재료 ${filtered.result.allowedCount}개`,
            updatedAt: new Date().toISOString(),
          },
          lastMessage: `일괄 실행 완료 · STEP 4까지 완료 · 최종 재료 ${filtered.result.allowedCount}개`,
          updatedAt: new Date().toISOString(),
        };
      }
      writeSession(current);
      window.localStorage.removeItem(AUTO_RUN_KEY);
      setProgress(current.lastMessage);
      window.setTimeout(() => window.location.reload(), 700);
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "STEP 4 일괄 실행 실패";
      writeMarker({ ...marker, status: "error", message: detail });
      const failed = readSession();
      if (failed) {
        writeSession({
          ...failed,
          lastMessage: `일괄 실행 오류 · ${detail}`,
          updatedAt: new Date().toISOString(),
        });
      }
      setError(detail);
      setProgress("");
    }
  }

  return (
    <section className="mx-auto mt-6 max-w-[1500px] px-5 text-slate-900">
      <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50/70 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">ONE CLICK · URL → STEP 4</div>
            <h2 className="mt-1 text-xl font-black">1688 링크 하나로 STEP 4까지 일괄 실행</h2>
            <p className="mt-1 text-sm text-slate-600">브라우저 원본수집 → STEP 1 자동분석/통과 → STEP 2 round 1 → STEP 3 round 1~3 자동확장 → STEP 4 금지키워드 제거 → 최종 상품명까지 진행합니다.</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-black ${collectorReady ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>Collector {collectorVersion || "미설치"}</span>
        </div>
        <div className="mt-4 flex flex-col gap-2 lg:flex-row">
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://detail.1688.com/offer/...html"
            className="min-w-0 flex-1 rounded-xl border border-emerald-300 bg-white px-4 py-3 text-sm"
          />
          <button
            type="button"
            disabled={!collectorReady || runningRef.current}
            onClick={startAutoRun}
            className="rounded-xl bg-emerald-700 px-6 py-3 text-sm font-black text-white disabled:opacity-40"
          >
            링크 → STEP 4 일괄 실행
          </button>
        </div>
        {progress ? <div className="mt-3 rounded-xl bg-white px-4 py-3 text-sm font-bold text-emerald-950 ring-1 ring-emerald-200">{progress}</div> : null}
        {error ? <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">{error}</div> : null}
      </div>
    </section>
  );
}
