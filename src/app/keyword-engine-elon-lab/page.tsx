"use client";

import { useEffect, useMemo, useState } from "react";

import {
  buildKeywordElonBrowserImportUrl,
  keywordElonSourceFromBrowserPayload,
  parseKeywordElonBrowserImportHash,
  versionAtLeast,
  KEYWORD_ELON_REQUIRED_COLLECTOR_VERSION,
} from "@/lib/keywordEngineElonLabBrowserImport";
import {
  KEYWORD_ELON_V2_DEFAULT_CUTOFF,
  KEYWORD_ELON_V2_MINIMUM_KEYWORDS,
  KEYWORD_ELON_V2_STORAGE_KEY,
  compactKeywordElonKey,
  emptyKeywordElonSession,
  keywordElonUtf8Bytes,
  validate1688Url,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonIdentity,
  type KeywordElonLabSession,
  type KeywordElonSourceDraft,
  type KeywordElonTitleResult,
} from "@/lib/keywordEngineElonLabV2";
import {
  mergeKeywordElonCandidates,
  mergeKeywordElonDiscovery,
} from "@/lib/keywordEngineElonLabV2Merge";

type Readiness = { openAiConfigured: boolean; searchAdConfigured: boolean };
type ApiRecord = Record<string, unknown> & { ok?: boolean; error?: unknown; errorStage?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function requestLab<T extends ApiRecord>(
  body?: Record<string, unknown>,
  method: "GET" | "POST" = "POST",
) {
  const response = await fetch("/api/keyword-engine-elon-lab", {
    method,
    headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    cache: "no-store",
  });
  const raw = await response.text();
  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(
      `서버가 JSON이 아닌 응답을 반환했습니다. HTTP ${response.status}: ${raw.slice(0, 220)}`,
    );
  }
  if (!isRecord(payload)) {
    throw new Error(`서버 응답 형식이 올바르지 않습니다. HTTP ${response.status}`);
  }
  if (!response.ok || payload.ok !== true) {
    const stage = typeof payload.errorStage === "string" ? payload.errorStage : "request";
    const message = typeof payload.error === "string" ? payload.error : `요청 실패 · HTTP ${response.status}`;
    throw new Error(message.startsWith("[") ? message : `[${stage}] ${message}`);
  }
  return payload as T;
}

function Chips({ values }: { values: string[] }) {
  if (!values.length) return <span className="text-sm text-slate-400">없음</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <span key={value} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
          {value}
        </span>
      ))}
    </div>
  );
}

function ScoreCell({ value }: { value: number }) {
  return <span className="font-semibold tabular-nums">{Number(value).toFixed(1)}</span>;
}

function loadLocalSession() {
  if (typeof window === "undefined") return emptyKeywordElonSession();
  try {
    const raw = window.localStorage.getItem(KEYWORD_ELON_V2_STORAGE_KEY);
    if (!raw) return emptyKeywordElonSession();
    const parsed = JSON.parse(raw) as Partial<KeywordElonLabSession>;
    if (parsed.version !== 2 || !parsed.source) return emptyKeywordElonSession();
    return {
      ...emptyKeywordElonSession(),
      ...parsed,
      cutoff: KEYWORD_ELON_V2_DEFAULT_CUTOFF,
      stage2Round: Number.isFinite(Number(parsed.stage2Round)) ? Math.max(0, Number(parsed.stage2Round)) : 0,
    } as KeywordElonLabSession;
  } catch {
    return emptyKeywordElonSession();
  }
}

function withNewSource(previous: KeywordElonLabSession, source: KeywordElonSourceDraft, message: string): KeywordElonLabSession {
  return {
    ...previous,
    source,
    identity: null,
    stage1Review: "pending",
    discovery: null,
    scoredCandidates: [],
    titleResult: null,
    stage2Status: "idle",
    stage2Round: 0,
    lastMessage: message,
    updatedAt: new Date().toISOString(),
  };
}

export default function KeywordEngineElonLabPage() {
  const [session, setSession] = useState<KeywordElonLabSession>(() => emptyKeywordElonSession());
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState<"" | "collect" | "identity" | "stage2" | "title">("");
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [collectorVersion, setCollectorVersion] = useState("");

  useEffect(() => {
    let next = loadLocalSession();
    let clearHash = false;
    try {
      const imported = parseKeywordElonBrowserImportHash(window.location.hash);
      if (imported) {
        const source = keywordElonSourceFromBrowserPayload(imported);
        next = withNewSource(
          next,
          source,
          `Commerce OS Keyword Lab Collector v${imported.collectorVersion || "?"} 수집 완료 · 중국 상품명과 옵션 ${imported.supplierOptionGroups.length}개 그룹을 불러왔습니다.`,
        );
        clearHash = true;
      }
    } catch (error) {
      next = {
        ...next,
        lastMessage: error instanceof Error ? error.message : "키워드 실험실 수집 자료를 읽지 못했습니다.",
      };
      clearHash = true;
    }
    if (clearHash) {
      window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(next);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(KEYWORD_ELON_V2_STORAGE_KEY, JSON.stringify(session));
  }, [hydrated, session]);

  useEffect(() => {
    let cancelled = false;
    requestLab<ApiRecord & Readiness>(undefined, "GET")
      .then((result) => {
        if (!cancelled) {
          setReadiness({
            openAiConfigured: result.openAiConfigured,
            searchAdConfigured: result.searchAdConfigured,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setReadiness(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const passing = useMemo(
    () => session.scoredCandidates.filter((row) => row.qualityScore >= session.cutoff),
    [session.scoredCandidates, session.cutoff],
  );
  const stage2Ready = session.stage1Review === "pass" && Boolean(session.identity);
  const minimumMet = passing.length >= KEYWORD_ELON_V2_MINIMUM_KEYWORDS;
  const collectorReady = versionAtLeast(collectorVersion, KEYWORD_ELON_REQUIRED_COLLECTOR_VERSION);

  function resetDownstream(source: KeywordElonSourceDraft, message = "원본 정보가 변경되어 STEP 1 이후 결과를 초기화했습니다.") {
    setSession((previous) => withNewSource(previous, source, message));
  }

  function updateSourceField(field: "url" | "chineseTitle" | "optionText" | "supportingText", value: string) {
    const source = { ...session.source, [field]: value };
    if (field === "url") {
      source.offerId = "";
      source.autoStatus = "idle";
      source.warnings = [];
    }
    resetDownstream(source);
  }

  function startBrowserSourceCollection() {
    const url = session.source.url.trim();
    if (!validate1688Url(url)) {
      setSession((previous) => ({ ...previous, lastMessage: "1688.com 상품 링크를 입력해 주세요." }));
      return;
    }
    if (!collectorReady) {
      setSession((previous) => ({
        ...previous,
        lastMessage: `Commerce OS Keyword Lab Collector v${KEYWORD_ELON_REQUIRED_COLLECTOR_VERSION}을 먼저 설치하거나 업데이트한 뒤 이 페이지를 새로고침해 주세요.`,
      }));
      return;
    }
    try {
      const returnUrl = new URL("/keyword-engine-elon-lab", window.location.origin).toString();
      window.location.assign(buildKeywordElonBrowserImportUrl(url, returnUrl));
    } catch (error) {
      setSession((previous) => ({
        ...previous,
        lastMessage: error instanceof Error ? error.message : "1688 브라우저 수집을 시작하지 못했습니다.",
      }));
    }
  }

  async function collectSourceServerFallback() {
    const url = session.source.url.trim();
    if (!validate1688Url(url)) {
      setSession((previous) => ({ ...previous, lastMessage: "1688.com 상품 링크를 입력해 주세요." }));
      return;
    }
    setBusy("collect");
    try {
      const result = await requestLab<ApiRecord & { source: KeywordElonSourceDraft }>({ action: "collect_source", url });
      const source: KeywordElonSourceDraft = {
        ...result.source,
        chineseTitle: result.source.chineseTitle || session.source.chineseTitle,
        optionText: result.source.optionText || session.source.optionText,
        supportingText: result.source.supportingText || session.source.supportingText,
      };
      resetDownstream(
        source,
        `서버 보조수집 ${source.autoStatus === "success" ? "완료" : source.autoStatus === "partial" ? "부분 완료" : "실패"}. 기본 수집은 전용 브라우저 수집기를 사용하세요.`,
      );
    } catch (error) {
      setSession((previous) => ({
        ...previous,
        lastMessage: error instanceof Error ? error.message : "1688 서버 보조수집 실패",
      }));
    } finally {
      setBusy("");
    }
  }

  async function analyzeIdentity() {
    if (!session.source.chineseTitle.trim() && !session.source.optionText.trim()) {
      setSession((previous) => ({ ...previous, lastMessage: "중국 상품명 또는 옵션정보를 입력해 주세요." }));
      return;
    }
    setBusy("identity");
    try {
      const result = await requestLab<ApiRecord & { identity: KeywordElonIdentity }>({
        action: "analyze_identity",
        source: session.source,
      });
      setSession((previous) => ({
        ...previous,
        identity: result.identity,
        stage1Review: "pending",
        discovery: null,
        scoredCandidates: [],
        titleResult: null,
        stage2Status: "idle",
        stage2Round: 0,
        lastMessage: "STEP 1 분석 완료. 상품 정체성과 Seed를 검수한 뒤 통과시켜 주세요.",
        updatedAt: new Date().toISOString(),
      }));
    } catch (error) {
      setSession((previous) => ({ ...previous, lastMessage: error instanceof Error ? error.message : "STEP 1 분석 실패" }));
    } finally {
      setBusy("");
    }
  }

  async function runStage2() {
    if (!session.identity || session.stage1Review !== "pass") return;
    const source = session.source;
    const identity = session.identity;
    const cutoff = session.cutoff;
    const round = (session.stage2Round ?? 0) + 1;
    const baseDiscovery = session.discovery;
    const baseCandidates = session.scoredCandidates;
    const previousKeys = new Set(baseCandidates.map((row) => compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword)));
    setBusy("stage2");
    setSession((previous) => ({
      ...previous,
      stage2Status: "discovering",
      lastMessage: `STEP 2 round ${round} · 기존 결과를 보존한 채 추가 후보를 수집하고 있습니다…`,
    }));
    try {
      const discovered = await requestLab<ApiRecord & { discovery: KeywordElonDiscovery }>({
        action: "discover_keywords",
        source,
        identity,
      });
      const newCandidateCount = discovered.discovery.candidates.filter(
        (keyword) => !previousKeys.has(compactKeywordElonKey(keyword)),
      ).length;
      setSession((previous) => ({
        ...previous,
        stage2Status: "scoring",
        lastMessage: `STEP 2 round ${round} · 신규 후보 ${newCandidateCount}개 확인 · 점수화 중…`,
      }));

      const scored = await requestLab<
        ApiRecord & {
          candidates: KeywordElonCandidate[];
          scoringWarnings?: string[];
          scoringChunkCount?: number;
          scoringSuccessfulChunks?: number;
        }
      >({
        action: "score_keywords",
        source,
        identity,
        discovery: discovered.discovery,
      });
      const scoreWarning = Array.isArray(scored.scoringWarnings) && scored.scoringWarnings.length
        ? ` · 일부 점수화 경고: ${scored.scoringWarnings[0]}`
        : "";
      const mergedCandidates = mergeKeywordElonCandidates(baseCandidates, scored.candidates);
      const mergedDiscovery = mergeKeywordElonDiscovery(baseDiscovery, discovered.discovery);
      const newlyPassed = mergedCandidates.filter(
        (row) => row.qualityScore >= cutoff && !previousKeys.has(compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword)),
      ).length;
      setSession((previous) => ({
        ...previous,
        discovery: mergedDiscovery,
        scoredCandidates: mergedCandidates,
        stage2Status: "title",
        lastMessage: `STEP 2 round ${round} · 누적 ${mergedCandidates.length}개 점수화 완료 · 신규 통과 ${newlyPassed}개${scoreWarning} · 상품명 조립 중…`,
      }));

      const titled = await requestLab<ApiRecord & { titleResult: KeywordElonTitleResult }>({
        action: "generate_title",
        source,
        identity,
        candidates: mergedCandidates,
        cutoff,
      });
      const passed = mergedCandidates.filter((row) => row.qualityScore >= cutoff).length;
      setSession((previous) => ({
        ...previous,
        discovery: mergedDiscovery,
        scoredCandidates: mergedCandidates,
        titleResult: titled.titleResult,
        stage2Status: "done",
        stage2Round: round,
        lastMessage:
          passed >= KEYWORD_ELON_V2_MINIMUM_KEYWORDS
            ? `STEP 2 round ${round} 완료 · 신규 후보 ${newCandidateCount}개 · 누적 후보 ${mergedCandidates.length}개 · ${cutoff}점 이상 ${passed}개 통과`
            : `STEP 2 round ${round} 완료 · 신규 후보 ${newCandidateCount}개 · 누적 후보 ${mergedCandidates.length}개 · ${cutoff}점 이상 ${passed}개. 추가 round 또는 STEP 3 확장이 필요합니다.`,
        updatedAt: new Date().toISOString(),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "STEP 2 실패";
      setSession((previous) => ({
        ...previous,
        stage2Status: "error",
        lastMessage: `STEP 2 round ${round} 실패 · ${message}`,
        updatedAt: new Date().toISOString(),
      }));
    } finally {
      setBusy("");
    }
  }

  async function regenerateTitle() {
    if (!session.identity || !session.scoredCandidates.length) return;
    setBusy("title");
    try {
      const result = await requestLab<ApiRecord & { titleResult: KeywordElonTitleResult }>({
        action: "generate_title",
        source: session.source,
        identity: session.identity,
        candidates: session.scoredCandidates,
        cutoff: session.cutoff,
      });
      setSession((previous) => ({
        ...previous,
        titleResult: result.titleResult,
        lastMessage: `현재 ${session.cutoff}점 커트라인으로 상품명을 다시 만들었습니다.`,
        updatedAt: new Date().toISOString(),
      }));
    } catch (error) {
      setSession((previous) => ({
        ...previous,
        lastMessage: error instanceof Error ? error.message : "상품명 재생성 실패",
      }));
    } finally {
      setBusy("");
    }
  }

  function newExperiment() {
    if (!window.confirm("현재 브라우저에 저장된 실험 결과를 비우고 새 1688 상품으로 시작할까요?")) return;
    setSession(emptyKeywordElonSession());
  }

  async function copySession() {
    await navigator.clipboard.writeText(JSON.stringify(session, null, 2));
    setSession((previous) => ({ ...previous, lastMessage: "현재 실험 JSON을 클립보드에 복사했습니다." }));
  }

  const statusLabel =
    session.stage2Status === "discovering"
      ? "후보 수집 중"
      : session.stage2Status === "scoring"
        ? "점수화 중"
        : session.stage2Status === "title"
          ? "상품명 생성 중"
          : session.stage2Status === "done"
            ? "완료"
            : session.stage2Status === "error"
              ? "오류"
              : "대기";

  return (
    <main className="mx-auto max-w-[1500px] space-y-6 px-5 py-8 text-slate-900">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Commerce OS · Keyword Lab V2</div>
            <h1 className="mt-2 text-3xl font-black">키워드엔진 일론머스크식 분해개선작업</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              1688 실제 화면에서 중국 상품명·옵션을 수집하고 상품 정체성을 확정한 뒤, 검증된 표준값(STEP2 60 · 월검색 품질 65 · 정확성 90)으로 키워드를 선별해 상품명까지 만듭니다.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={copySession} className="rounded-lg border px-4 py-2 text-sm font-bold">실험 JSON 복사</button>
            <button onClick={newExperiment} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white">새 실험 시작</button>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold">
          <span className={`rounded-full px-3 py-1 ${readiness?.openAiConfigured ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
            OpenAI {readiness?.openAiConfigured ? "연결" : "미설정"}
          </span>
          <span className={`rounded-full px-3 py-1 ${readiness?.searchAdConfigured ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
            SearchAd {readiness?.searchAdConfigured ? "연결" : "선택적 미설정"}
          </span>
          <span className={`rounded-full px-3 py-1 ${collectorReady ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
            Keyword Lab Collector {collectorVersion || "미설치"}
          </span>
          <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-800">브라우저 자동저장</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">Shopling/Supabase 쓰기 없음</span>
        </div>
        {session.lastMessage ? (
          <div className={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold ${session.stage2Status === "error" ? "bg-rose-50 text-rose-900" : "bg-blue-50 text-blue-900"}`}>
            {session.lastMessage}
          </div>
        ) : null}
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-black text-white">STEP 1</span>
          <div>
            <h2 className="text-xl font-black">1688 원본 → 상품 정체성 · Seed 확정</h2>
            <p className="text-sm text-slate-500">판매자가 만든 모델명은 사용하지 않습니다. 중국 원본 상품명과 실제 옵션만 사용합니다.</p>
          </div>
        </div>

        {!collectorReady ? (
          <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            <div className="font-black">Commerce OS Keyword Lab Collector v{KEYWORD_ELON_REQUIRED_COLLECTOR_VERSION} 설치 필요</div>
            <p className="mt-1 leading-6">상세페이지 SaaS와는 별개의 키워드 실험실 전용 수집기입니다. ZIP을 받아 압축을 풀고 chrome://extensions에서 `압축해제된 확장 프로그램 로드` 후 이 탭을 새로고침하세요.</p>
            <a href="/api/keyword-engine-elon-lab/collector-zip" className="mt-3 inline-block rounded-lg bg-slate-900 px-4 py-2 font-black text-white">전용 수집기 ZIP 다운로드</a>
          </div>
        ) : (
          <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
            전용 수집기 v{collectorVersion} 연결 완료 · 1688 렌더링 DOM에서 상품명·옵션명·옵션값을 직접 읽습니다.
          </div>
        )}

        <label className="text-sm font-bold">1688 중국 상품 링크</label>
        <div className="mt-2 flex flex-col gap-2 lg:flex-row">
          <input value={session.source.url} onChange={(event) => updateSourceField("url", event.target.value)} placeholder="https://detail.1688.com/offer/...html" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm" />
          <button disabled={busy !== "" || !collectorReady} onClick={startBrowserSourceCollection} className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white disabled:opacity-40">1688 브라우저 자동수집</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded bg-slate-100 px-2 py-1">offerId: {session.source.offerId || "—"}</span>
          <span className="rounded bg-slate-100 px-2 py-1">자동수집: {session.source.autoStatus}</span>
        </div>

        {session.source.warnings.length ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="font-black">수집 참고</div>
            {session.source.warnings.map((warning) => <div key={warning} className="mt-1">• {warning}</div>)}
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <label className="space-y-2 text-sm font-bold">중국 상품명
            <textarea value={session.source.chineseTitle} onChange={(event) => updateSourceField("chineseTitle", event.target.value)} rows={4} placeholder="브라우저 자동수집 결과가 들어옵니다. 필요하면 직접 수정할 수 있습니다." className="w-full rounded-xl border border-slate-300 p-3 font-normal" />
          </label>
          <label className="space-y-2 text-sm font-bold">중국 옵션명 · 옵션값
            <textarea value={session.source.optionText} onChange={(event) => updateSourceField("optionText", event.target.value)} rows={4} placeholder="예: 颜色: 粉色 / 黑色\n规格: 大号 / 小号" className="w-full rounded-xl border border-slate-300 p-3 font-normal" />
          </label>
        </div>

        <details className="mt-4 rounded-xl border border-slate-200 p-4">
          <summary className="cursor-pointer text-sm font-bold">보조 텍스트 / 서버 보조수집</summary>
          <button disabled={busy !== ""} onClick={collectSourceServerFallback} className="mt-3 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-black">{busy === "collect" ? "서버 보조수집 중…" : "서버 보조수집 실행"}</button>
          <textarea value={session.source.supportingText} onChange={(event) => updateSourceField("supportingText", event.target.value)} rows={7} className="mt-3 w-full rounded-xl border border-slate-300 p-3 text-xs" />
        </details>

        <button disabled={busy !== "" || (!session.source.chineseTitle.trim() && !session.source.optionText.trim())} onClick={analyzeIdentity} className="mt-5 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-black text-white disabled:opacity-40">
          {busy === "identity" ? "상품 정체성 분석 중…" : "STEP 1 · 상품 정체성·Seed 분석"}
        </button>

        {session.identity ? (
          <div className="mt-6 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div><div className="text-xs font-bold text-slate-500">상품 정체성</div><div className="mt-1 text-lg font-black">{session.identity.koreanProductIdentity}</div></div>
              <div><div className="text-xs font-bold text-slate-500">CORE_PRODUCT</div><div className="mt-1 font-black">{session.identity.coreProduct}</div></div>
              <div><div className="text-xs font-bold text-slate-500">IDENTITY_ANCHOR</div><div className="mt-1 font-black">{session.identity.identityAnchor}</div></div>
            </div>
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div><div className="mb-2 text-xs font-black text-blue-700">PRIMARY SEED</div><Chips values={session.identity.primarySeeds} /></div>
              <div><div className="mb-2 text-xs font-black text-amber-700">CONDITIONAL SEED</div><Chips values={session.identity.conditionalSeeds} /></div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-4 text-sm">
              <div><div className="font-bold">기능/종류</div><Chips values={session.identity.functionModifiers} /></div>
              <div><div className="font-bold">디자인/형상</div><Chips values={session.identity.designShapeModifiers} /></div>
              <div><div className="font-bold">스펙</div><Chips values={session.identity.specAttributes} /></div>
              <div><div className="font-bold">옵션 Noise</div><Chips values={session.identity.variantNoise} /></div>
            </div>
            <div className="mt-5 rounded-xl bg-white p-4 text-sm"><b>AI 신뢰도:</b> {(session.identity.confidence * 100).toFixed(0)}% · <b>근거:</b> {session.identity.reasoning}</div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setSession((previous) => ({ ...previous, stage1Review: "pass", lastMessage: "STEP 1 통과. STEP 2를 실행할 수 있습니다." }))} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-black text-white">✓ STEP 1 통과</button>
              <button onClick={() => setSession((previous) => ({ ...previous, stage1Review: "improve", lastMessage: "STEP 1 개선 필요로 표시했습니다. 원본을 보완하거나 다시 분석하세요." }))} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-black text-white">개선 필요</button>
            </div>
          </div>
        ) : null}
      </section>

      <section className={`rounded-2xl border bg-white p-6 shadow-sm ${stage2Ready ? "border-slate-200" : "border-slate-100 opacity-70"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-violet-600 px-3 py-1 text-xs font-black text-white">STEP 2</span>
            <div><h2 className="text-xl font-black">키워드 대량 발굴 → 품질점수 → 커트라인</h2><p className="text-sm text-slate-500">Round를 반복할수록 기존 결과를 버리지 않고 신규 후보만 누적합니다.</p></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${session.stage2Status === "error" ? "bg-rose-100 text-rose-800" : "bg-slate-100"}`}>{statusLabel}</span>
            <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-800">완료 round {session.stage2Round ?? 0}</span>
          </div>
        </div>

        {!stage2Ready ? (
          <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">STEP 1의 상품 정체성과 Seed를 확인하고 `STEP 1 통과`를 눌러 주세요.</div>
        ) : (
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button disabled={busy !== ""} onClick={runStage2} className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-black text-white disabled:opacity-40">
              {busy === "stage2" ? `STEP 2 round ${(session.stage2Round ?? 0) + 1} 실행 중 · ${statusLabel}` : session.stage2Round > 0 ? `STEP 2 · 추가발굴 round ${session.stage2Round + 1}` : "STEP 2 · 키워드 대량 발굴 round 1"}
            </button>
            <span className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-black text-violet-950">표준 품질 커트라인 60점 · 고정</span>
            <span className="text-sm text-slate-500">기존 결과 누적 · 최소 목표 {KEYWORD_ELON_V2_MINIMUM_KEYWORDS}개 · 상한 없음</span>
          </div>
        )}

        {session.stage2Status === "error" ? (
          <div className="mt-5 rounded-2xl border-2 border-rose-300 bg-rose-50 p-5 text-rose-950">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-base font-black">STEP 2 실행 오류 · 상세 진단</div>
              <span className="rounded-full bg-rose-200 px-3 py-1 text-xs font-black text-rose-900">실패 원인 표시</span>
            </div>
            <div className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-white p-4 font-mono text-xs leading-6 text-rose-900">{session.lastMessage || "오류 메시지가 없습니다."}</div>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
              <div className="rounded-lg bg-white p-3"><b>수집 후보</b><div className="mt-1">{session.discovery?.candidates.length ?? 0}개</div></div>
              <div className="rounded-lg bg-white p-3"><b>SearchAd 연관어</b><div className="mt-1">{session.discovery?.relatedKeywordCount ?? 0}개</div></div>
              <div className="rounded-lg bg-white p-3"><b>점수 완료</b><div className="mt-1">{session.scoredCandidates.length}개</div></div>
            </div>
            <p className="mt-3 text-xs leading-5">오류 코드는 그대로 보존됩니다. 다음 수정 때 캡처 없이 이 메시지만으로 실패 지점을 구분할 수 있습니다.</p>
          </div>
        ) : null}

        {session.discovery ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-xl bg-slate-50 p-4"><div className="text-xs font-bold text-slate-500">누적 후보</div><div className="mt-1 text-2xl font-black">{session.discovery.candidates.length}</div></div>
            <div className="rounded-xl bg-emerald-50 p-4"><div className="text-xs font-bold text-emerald-700">커트 통과</div><div className="mt-1 text-2xl font-black text-emerald-800">{passing.length}</div></div>
            <div className="rounded-xl bg-blue-50 p-4"><div className="text-xs font-bold text-blue-700">AI 확장 누적</div><div className="mt-1 text-2xl font-black">{session.discovery.aiGeneratedCount}</div></div>
            <div className="rounded-xl bg-violet-50 p-4"><div className="text-xs font-bold text-violet-700">SearchAd 연관어</div><div className="mt-1 text-2xl font-black">{session.discovery.relatedKeywordCount}</div></div>
            <div className="rounded-xl bg-amber-50 p-4"><div className="text-xs font-bold text-amber-700">수요 데이터</div><div className="mt-1 text-sm font-black">{session.discovery.searchAdConfigured ? "연결" : "없음"}</div></div>
          </div>
        ) : null}

        {session.discovery?.searchAdWarnings.length ? (
          <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">{session.discovery.searchAdWarnings.join(" · ")}</div>
        ) : null}

        {session.scoredCandidates.length ? (
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-[1150px] w-full border-collapse text-sm">
              <thead><tr className="border-b bg-slate-50 text-left text-xs text-slate-600"><th className="p-3">순위</th><th className="p-3">키워드</th><th className="p-3">품질</th><th className="p-3">월검색</th><th className="p-3">관련성</th><th className="p-3">쇼핑의도</th><th className="p-3">구체성</th><th className="p-3">경쟁기회</th><th className="p-3">상품명</th><th className="p-3">근거/출처</th></tr></thead>
              <tbody>
                {session.scoredCandidates.map((row, index) => {
                  const pass = row.qualityScore >= session.cutoff;
                  return (
                    <tr key={`${row.searchKey}-${index}`} className={`border-b ${pass ? "bg-emerald-50/50" : "bg-white"}`}>
                      <td className="p-3 tabular-nums">{index + 1}</td>
                      <td className="p-3"><div className="font-black">{row.keyword}</div><div className={`mt-1 inline-block rounded px-2 py-0.5 text-[11px] font-bold ${pass ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>{pass ? "통과" : "컷 미만"}</div></td>
                      <td className="p-3"><ScoreCell value={row.qualityScore} /></td>
                      <td className="p-3 tabular-nums">{row.totalSearch === null ? "—" : row.totalSearch.toLocaleString()}</td>
                      <td className="p-3"><ScoreCell value={row.relevance} /></td>
                      <td className="p-3"><ScoreCell value={row.shoppingIntent} /></td>
                      <td className="p-3"><ScoreCell value={row.specificity} /></td>
                      <td className="p-3"><ScoreCell value={row.competitionOpportunity} /></td>
                      <td className="p-3">{row.titleEligible ? "✅" : "—"}</td>
                      <td className="max-w-[340px] p-3 text-xs text-slate-600"><div>{row.rationale}</div><div className="mt-1 text-slate-400">{row.sourceTags.join(", ") || "AI 평가"} · {row.dataConfidence}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {session.scoredCandidates.length ? (
        <section className="rounded-2xl border-2 border-slate-900 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-xs font-black tracking-[0.16em] text-slate-500">FINAL RESULT</div><h2 className="mt-1 text-2xl font-black">상품명 + 품질 통과 키워드 전체</h2></div>
            <span className={`rounded-full px-4 py-2 text-sm font-black ${minimumMet ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>{minimumMet ? `PASS · ${passing.length}개` : `추가 발굴 필요 · ${passing.length}/${KEYWORD_ELON_V2_MINIMUM_KEYWORDS}`}</span>
          </div>
          {!minimumMet ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">커트라인 미만 키워드를 억지로 채우지 않습니다. STEP 2 추가 round 또는 STEP 3 확장을 실행하세요.</div> : null}
          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.5fr]">
            <div className="rounded-2xl bg-slate-900 p-5 text-white">
              <div className="text-xs font-bold text-slate-300">추천 상품명</div>
              <div className="mt-2 text-2xl font-black">{session.titleResult?.title || "현재 커트라인으로 상품명을 생성해 주세요."}</div>
              {session.titleResult ? <><div className="mt-3 text-xs text-slate-300">{session.titleResult.byteLength} bytes · model {session.titleResult.model}</div><div className="mt-4"><div className="mb-2 text-xs font-bold text-slate-300">사용 키워드</div><div className="flex flex-wrap gap-2">{session.titleResult.usedKeywords.map((keyword) => <span key={keyword} className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold">{keyword}</span>)}</div></div></> : null}
              <button disabled={busy !== ""} onClick={regenerateTitle} className="mt-5 rounded-lg bg-white px-4 py-2 text-sm font-black text-slate-900 disabled:opacity-40">{busy === "title" ? "상품명 생성 중…" : "현재 커트라인으로 상품명 다시 생성"}</button>
            </div>
            <div className="rounded-2xl bg-slate-50 p-5"><div className="text-xs font-bold text-slate-500">상품 정체성</div><div className="mt-1 text-lg font-black">{session.identity?.koreanProductIdentity}</div><div className="mt-4 text-xs font-bold text-slate-500">Primary Seed</div><div className="mt-2"><Chips values={session.identity?.primarySeeds ?? []} /></div><div className="mt-4 text-xs font-bold text-slate-500">품질 커트라인</div><div className="mt-1 text-xl font-black">{session.cutoff}점</div></div>
          </div>
          <div className="mt-6"><h3 className="text-lg font-black">통과 키워드 · 점수 높은 순</h3><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{passing.map((row, index) => <div key={`final-${row.searchKey}-${index}`} className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3"><div><span className="mr-3 text-xs font-black text-emerald-700">#{index + 1}</span><span className="font-black">{row.keyword}</span></div><span className="font-black tabular-nums text-emerald-800">{row.qualityScore.toFixed(1)}</span></div>)}</div></div>
        </section>
      ) : null}

      <footer className="pb-8 text-center text-xs text-slate-400">세션 저장키: {KEYWORD_ELON_V2_STORAGE_KEY} · 현재 추천 상품명 {session.titleResult ? keywordElonUtf8Bytes(session.titleResult.title) : 0} bytes</footer>
    </main>
  );
}
