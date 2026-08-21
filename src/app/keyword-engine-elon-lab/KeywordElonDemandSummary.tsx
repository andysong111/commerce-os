"use client";

import { useEffect, useMemo, useState } from "react";

import {
  KEYWORD_ELON_V2_STORAGE_KEY,
  compactKeywordElonKey,
  type KeywordElonCandidate,
  type KeywordElonLabSession,
} from "@/lib/keywordEngineElonLabV2";
import {
  readKeywordElonSelectionThresholds,
  selectKeywordElonAccuracyCandidates,
  selectKeywordElonDemandCandidates,
  selectKeywordElonStep4Union,
} from "@/lib/keywordEngineElonLabV2Selection";

const V6_CACHE_RESET_MARKER = "keywordElon.marketRecallV6.cacheReset";

function readSession() {
  try {
    const raw = window.localStorage.getItem(KEYWORD_ELON_V2_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as KeywordElonLabSession;
  } catch {
    return null;
  }
}

function KeywordRow({ row, rank, metric }: { row: KeywordElonCandidate; rank: number; metric: "demand" | "accuracy" }) {
  const keyword = row.searchKeyword || row.searchKey || compactKeywordElonKey(row.keyword);
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
      <div className="min-w-0">
        <span className="mr-2 text-xs font-black text-slate-400">#{rank}</span>
        <span className="font-black">{keyword}</span>
        <div className="mt-1 text-xs text-slate-500">
          관련성 {row.relevance.toFixed(0)} · 쇼핑의도 {row.shoppingIntent.toFixed(0)} · 최종 {row.qualityScore.toFixed(1)}
          {row.trendScore !== null && row.trendScore !== undefined ? ` · 추세 ${row.trendScore.toFixed(0)}` : ""}
        </div>
      </div>
      <div className="shrink-0 text-right">
        {metric === "demand" ? (
          <><div className="font-black tabular-nums">{row.totalSearch === null ? "—" : row.totalSearch.toLocaleString()}</div><div className="text-[11px] text-slate-400">월검색</div></>
        ) : (
          <><div className="font-black tabular-nums">{row.relevance.toFixed(0)}</div><div className="text-[11px] text-slate-400">관련성</div></>
        )}
      </div>
    </div>
  );
}

function TagChips({ values }: { values: string[] }) {
  if (!values.length) return <span className="text-xs text-slate-400">없음</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {values.slice(0, 30).map((value) => (
        <span key={value} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">{compactKeywordElonKey(value)}</span>
      ))}
    </div>
  );
}

export default function KeywordElonDemandSummary() {
  const [session, setSession] = useState<KeywordElonLabSession | null>(null);
  const thresholds = useMemo(() => readKeywordElonSelectionThresholds(), []);

  useEffect(() => {
    if (window.localStorage.getItem(V6_CACHE_RESET_MARKER) !== "1") {
      const staleKeys: string[] = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith("keywordElon.scoreBridge.")) staleKeys.push(key);
      }
      for (const key of staleKeys) window.localStorage.removeItem(key);
      window.localStorage.setItem(V6_CACHE_RESET_MARKER, "1");
    }

    let last = "";
    const sync = () => {
      const raw = window.localStorage.getItem(KEYWORD_ELON_V2_STORAGE_KEY) || "";
      if (raw === last) return;
      last = raw;
      setSession(readSession());
    };
    sync();
    const timer = window.setInterval(sync, 700);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const safe = useMemo(() => (session?.scoredCandidates ?? []).filter((row) => row.safetyPass === true), [session]);
  const demandQualified = useMemo(() => selectKeywordElonDemandCandidates(session?.scoredCandidates ?? [], thresholds), [session, thresholds]);
  const accuracyQualified = useMemo(() => selectKeywordElonAccuracyCandidates(session?.scoredCandidates ?? [], thresholds), [session, thresholds]);
  const step4Union = useMemo(() => selectKeywordElonStep4Union(session?.scoredCandidates ?? [], thresholds), [session, thresholds]);
  const demandTop = useMemo(() => demandQualified.slice(0, 12), [demandQualified]);
  const accuracyTop = useMemo(() => accuracyQualified.slice(0, 12), [accuracyQualified]);

  if (!session?.scoredCandidates?.length || session.stage2Status !== "done") return null;
  const measured = safe.filter((row) => row.totalSearch !== null).length;
  const expansionSeeds = session.discovery?.demandExpansionSeeds ?? [];
  const bridgeTerms = session.discovery?.marketBridgeSeeds ?? [];
  const evidenceTerms = session.discovery?.marketTerms ?? [];
  const activeSources = session.discovery?.apiHubActiveSources ?? [];
  const trendSignals = session.discovery?.trendSignals ?? [];
  const warnings = [...(session.discovery?.searchAdWarnings ?? []), ...(session.discovery?.trendWarnings ?? [])];
  const permissionWarnings = warnings.filter((warning) => warning.includes("PERMISSION_REQUIRED"));
  const apiHubMissing = session.discovery?.apiHubConfigured === false;

  return (
    <section className="mx-auto mb-10 mt-[-1rem] max-w-[1500px] px-5 text-slate-900">
      <div className="rounded-2xl border-2 border-violet-200 bg-violet-50/40 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">STEP 2 · MARKET RECALL V6</div>
            <h2 className="mt-1 text-2xl font-black">Evidence Market Mine + SearchAd 수요 계측</h2>
            <p className="mt-2 text-sm text-slate-600">실제 시장 문서와 SearchAd에서 모은 후보를 수요와 상품 정확성 두 개의 그물로 따로 선별합니다. 10개 상품 × 64조합 실험으로 확정한 표준값을 고정 적용합니다.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-black">
            <span className="rounded-full bg-cyan-100 px-3 py-1 text-cyan-900">Bridge {bridgeTerms.length}개</span>
            <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-900">증거 시장어 {evidenceTerms.length}개</span>
            <span className="rounded-full bg-indigo-100 px-3 py-1 text-indigo-900">문서 {session.discovery?.apiHubDocumentCount ?? 0}건</span>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">안전 Gate {safe.length}개</span>
            <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-800">월검색 측정 {measured}개</span>
            <span className="rounded-full bg-fuchsia-100 px-3 py-1 text-fuchsia-900">STEP 4 합집합 {step4Union.length}개</span>
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-white p-4 text-xs leading-6 text-slate-600">
          안전 Gate(관련성 80 / 쇼핑의도 70)는 고정 유지합니다. 월검색량 TOP은 품질점수 기준을, 상품정확성 TOP은 관련성 기준을 각각 적용한 뒤 두 집합을 합쳐 STEP 4에 전달합니다. 중복 키워드는 한 번만 남습니다.
          {activeSources.length ? ` · API HUB 활성: ${activeSources.join(" / ")}` : " · API HUB 활성소스 없음"}
          {expansionSeeds.length ? ` · 2차 SearchAd Seed: ${expansionSeeds.map(compactKeywordElonKey).join(" / ")}` : ""}
        </div>

        {apiHubMissing ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">NAVER API HUB 인증정보가 연결되지 않았습니다.</div> : null}
        {permissionWarnings.length ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950"><div className="font-black">NAVER API HUB Application 권한 활성화 필요</div><div className="mt-2 space-y-1 text-xs">{permissionWarnings.slice(0, 8).map((warning) => <div key={warning}>{warning}</div>)}</div></div> : null}

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-cyan-100 bg-cyan-50/50 p-4"><div className="mb-3 text-sm font-black text-cyan-950">Market Bridge · 최대 15개</div><TagChips values={bridgeTerms} /></div>
          <div className="rounded-2xl border border-sky-100 bg-sky-50/50 p-4"><div className="mb-3 text-sm font-black text-sky-950">API HUB Evidence 시장어</div><TagChips values={evidenceTerms} /></div>
        </div>

        {trendSignals.length ? (
          <div className="mt-5 rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-black text-amber-950">Search Trend · 최근 검색 흐름</div>
              <div className="text-xs font-bold text-amber-800">상위 {Math.min(10, trendSignals.length)}개</div>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {trendSignals.slice(0, 10).map((signal) => (
                <div key={signal.keyword} className="rounded-xl bg-white px-3 py-2 text-xs text-slate-700 ring-1 ring-amber-100">
                  <div className="font-black">{compactKeywordElonKey(signal.keyword)}</div>
                  <div className="mt-1 tabular-nums text-slate-500">추세 {signal.score.toFixed(0)} · 모멘텀 {signal.momentum.toFixed(1)} · 최근 {signal.recentAverage.toFixed(1)} / 이전 {signal.priorAverage.toFixed(1)}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div><h3 className="text-lg font-black">월검색량 TOP · canonical no-space</h3><div className="mt-1 text-xs text-slate-500">기준 통과 {demandQualified.length}개 · 월검색량 높은 순</div></div>
              <span className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-black text-blue-950">표준 품질점수 ≥ 65 · 고정</span>
            </div>
            <div className="space-y-2">{demandTop.length ? demandTop.map((row, index) => <KeywordRow key={`demand-${row.searchKey}`} row={row} rank={index + 1} metric="demand" />) : <div className="rounded-xl bg-white p-4 text-sm text-slate-500">현재 월검색량 기준을 통과한 후보가 없습니다.</div>}</div>
          </div>

          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div><h3 className="text-lg font-black">상품 정확성 TOP</h3><div className="mt-1 text-xs text-slate-500">기준 통과 {accuracyQualified.length}개 · 관련성 높은 순</div></div>
              <span className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm font-black text-emerald-950">표준 관련성 ≥ 90 · 고정</span>
            </div>
            <div className="space-y-2">{accuracyTop.length ? accuracyTop.map((row, index) => <KeywordRow key={`accuracy-${row.searchKey}`} row={row} rank={index + 1} metric="accuracy" />) : <div className="rounded-xl bg-white p-4 text-sm text-slate-500">현재 상품정확성 기준을 통과한 후보가 없습니다.</div>}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
