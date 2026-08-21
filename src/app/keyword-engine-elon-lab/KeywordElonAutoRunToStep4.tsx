"use client";

import { useEffect, useRef, useState } from "react";

import {
  buildKeywordElonBrowserImportUrl,
  versionAtLeast,
  KEYWORD_ELON_REQUIRED_COLLECTOR_VERSION,
} from "@/lib/keywordEngineElonLabBrowserImport";
import {
  KEYWORD_ELON_V2_DEFAULT_CUTOFF,
  KEYWORD_ELON_V2_STORAGE_KEY,
  compactKeywordElonKey,
  parse1688OfferId,
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
import {
  readKeywordElonSelectionThresholds,
  selectKeywordElonStep4Union,
  type KeywordElonSelectionThresholds,
} from "@/lib/keywordEngineElonLabV2Selection";
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

function fingerprint(
  candidates: KeywordElonCandidate[],
  thresholds: KeywordElonSelectionThresholds,
  customTerms: string[],
  round: number,
) {
  return [
    "dual-selection:v1",
    `demandQuality:${thresholds.demandQuality}`,
    `accuracyRelevance:${thresholds.accuracyRelevance}`,
    `round:${round}`,
    `custom:${customTerms.join(",")}`,
    ...candidates.map((row) => `${compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword)}:${row.qualityScore.toFixed(2)}:${row.relevance.toFixed(0)}`),
  ].join("|");
}

export default function KeywordElonAutoRunToStep4() {
  const [url, setUrl] = useState("");
  const [collectorVersion, setCollectorVersion] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [autoRunning, setAutoRunning] = useState(false);
  const [resultSession, setResultSession] = useState<ExtendedSession | null>(null);
  const [copied, setCopied] = useState(false);
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
    const syncResult = () => {
      if (cancelled) return;
      const current = readSession();
      setResultSession(current);
      setCopied(false);
      setUrl((previous) => previous || current?.source.url || "");
    };
    const initialTimer = window.setTimeout(syncResult, 0);
    window.addEventListener("keyword-elon-session-updated", syncResult);
    window.addEventListener("storage", syncResult);
    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.removeEventListener("keyword-elon-session-updated", syncResult);
      window.removeEventListener("storage", syncResult);
    };
  }, []);

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
        cutoff: KEYWORD_ELON_V2_DEFAULT_CUTOFF,
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

      setProgress("일괄 실행 6/6 · 표준 월검색 품질 65 / 정확성 90 합집합에 STEP 4 위험필터 적용 중…");
      const selectionThresholds = readKeywordElonSelectionThresholds();
      const finalCandidates = selectKeywordElonStep4Union(current.scoredCandidates, selectionThresholds);
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
            inputFingerprint: fingerprint(finalCandidates, selectionThresholds, customBlockedTerms, current.step3?.round ?? 3),
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
            cutoff: 0,
          });
          titleResult = titled.titleResult;
        }
        current = {
          ...current,
          titleResult,
          step4: {
            ...filtered.result,
            status: "done",
            inputFingerprint: fingerprint(finalCandidates, selectionThresholds, customBlockedTerms, current.step3?.round ?? 3),
            customBlockedTerms,
            titleResult,
            lastMessage: `STEP 4 완료 · ${filtered.result.removedCount}개 제거 · 최종 재료 ${filtered.result.allowedCount}개`,
            updatedAt: new Date().toISOString(),
          },
          lastMessage: `일괄 실행 완료 · 표준값 60 / 65 / 90 · STEP 4 최종 재료 ${filtered.result.allowedCount}개`,
          updatedAt: new Date().toISOString(),
        };
      }
      writeSession(current);
      window.localStorage.removeItem(AUTO_RUN_KEY);
      setResultSession(current);
      setCopied(false);
      setProgress(
        current.titleResult
          ? "FINAL RESULT 생성 완료 · STEP 1~4 전체 실행을 마쳤습니다."
          : current.lastMessage,
      );
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

  useEffect(() => {
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (cancelled || runningRef.current) return;
      const marker = readMarker();
      if (!marker || marker.status !== "armed") return;
      const session = readSession();
      if (!session) return;
      const sameOffer = same1688Offer(marker.url, session);
      const sourceReady = Boolean(session.source.chineseTitle.trim() || session.source.optionText.trim());
      if (!sameOffer || !sourceReady) return;
      runningRef.current = true;
      setAutoRunning(true);
      writeMarker({ ...marker, status: "running", message: "수집 완료 · STEP 1 자동분석 시작" });
      setProgress("1688 수집 완료 · STEP 1부터 STEP 4까지 자동 실행을 시작합니다.");
      void runPipeline(session, marker).finally(() => {
        runningRef.current = false;
        setAutoRunning(false);
      });
    }, 400);
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
    setResultSession(null);
    setCopied(false);
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



  const step4Complete = resultSession?.step4?.status === "done";
  const finalTitle = step4Complete
    ? resultSession?.titleResult ?? resultSession?.step4?.titleResult ?? null
    : null;
  const finalAllowedKeys = new Set(step4Complete ? resultSession?.step4?.allowedKeys ?? [] : []);
  const finalRows = step4Complete && resultSession
    ? selectKeywordElonStep4Union(resultSession.scoredCandidates, readKeywordElonSelectionThresholds()).filter((row) =>
        finalAllowedKeys.has(compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword)),
      )
    : [];

  async function copyFinalResult() {
    if (!finalTitle?.title) return;
    const keywordLine = finalRows.length
      ? `키워드: ${finalRows.map((row) => row.searchKeyword || row.searchKey || row.keyword).join(", ")}`
      : "";
    try {
      await navigator.clipboard.writeText([finalTitle.title, keywordLine].filter(Boolean).join("\n"));
      setCopied(true);
    } catch {
      setError("FINAL RESULT를 클립보드에 복사하지 못했습니다.");
    }
  }

  return (
    <section className="mx-auto mt-6 max-w-[1500px] px-5 text-slate-900">
      <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50/70 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">ONE CLICK · 1688 URL → FINAL RESULT</div>
            <h2 className="mt-1 text-xl font-black">링크 하나로 STEP 1~4 전체 실행</h2>
            <p className="mt-1 text-sm text-slate-600">1688 원본수집부터 STEP 4 위험어 제거와 최종 상품명 생성까지 자동 진행합니다. STEP 5는 자동 실행하지 않고 결과를 본 뒤 직접 선택합니다.</p>
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
            disabled={!collectorReady || autoRunning}
            onClick={startAutoRun}
            className="rounded-xl bg-emerald-700 px-6 py-3 text-sm font-black text-white disabled:opacity-40"
          >
            {autoRunning ? "STEP 1~4 실행 중…" : "FINAL RESULT 받기"}
          </button>
        </div>
        {progress ? <div className="mt-3 rounded-xl bg-white px-4 py-3 text-sm font-bold text-emerald-950 ring-1 ring-emerald-200">{progress}</div> : null}
        {error ? <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">{error}</div> : null}

        {step4Complete ? (
          <div id="keyword-final-result" className="mt-5 rounded-2xl border-2 border-slate-900 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">FINAL RESULT</div>
                <h3 className="mt-1 text-xl font-black text-slate-950">STEP 4 완료 결과</h3>
              </div>
              <div className="flex flex-wrap gap-2 text-xs font-black">
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">STEP 4 완료</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">최종 키워드 {finalRows.length}개</span>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">STEP 5 자동 실행 안 함</span>
              </div>
            </div>

            {finalTitle ? (
              <div className="mt-4 rounded-2xl bg-slate-950 p-5 text-white">
                <div className="text-xs font-bold text-slate-400">추천 상품명</div>
                <div className="mt-2 text-2xl font-black leading-snug">{finalTitle.title}</div>
                <div className="mt-3 text-xs text-slate-400">{finalTitle.byteLength} bytes · model {finalTitle.model}</div>
                <button
                  type="button"
                  onClick={copyFinalResult}
                  className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-black text-slate-950"
                >
                  {copied ? "복사 완료" : "FINAL RESULT 복사"}
                </button>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
                STEP 4까지 완료했지만 최종 통과 키워드가 없어 상품명을 만들지 못했습니다. 아래 STEP 1~4 세부내용을 펼쳐 원인을 확인하세요.
              </div>
            )}

            {finalRows.length ? (
              <details className="group mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-slate-800 marker:content-none">
                  <span>최종 사용 키워드 {finalRows.length}개</span>
                  <span className="rounded-lg bg-white px-3 py-1.5 text-xs ring-1 ring-slate-200">
                    <span className="group-open:hidden">펼쳐보기</span>
                    <span className="hidden group-open:inline">숨기기</span>
                  </span>
                </summary>
                <div className="mt-3 flex flex-wrap gap-2">
                  {finalRows.map((row) => {
                    const keyword = row.searchKeyword || row.searchKey || row.keyword;
                    return <span key={compactKeywordElonKey(keyword)} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">{keyword}</span>;
                  })}
                </div>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
