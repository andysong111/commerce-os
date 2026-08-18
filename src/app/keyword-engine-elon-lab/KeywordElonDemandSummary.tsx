"use client";

import { useEffect, useMemo, useState } from "react";

import {
  KEYWORD_ELON_V2_STORAGE_KEY,
  compactKeywordElonKey,
  type KeywordElonCandidate,
  type KeywordElonLabSession,
} from "@/lib/keywordEngineElonLabV2";

const V5_CACHE_RESET_MARKER = "keywordElon.marketRecallV5.cacheReset";

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
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
      <div className="min-w-0">
        <span className="mr-2 text-xs font-black text-slate-400">#{rank}</span>
        <span className="font-black">{row.searchKeyword || row.searchKey}</span>
        {row.keyword !== (row.searchKeyword || row.searchKey) ? <div className="mt-1 text-[11px] text-slate-400">표현 원형: {row.keyword}</div> : null}
        <div className="mt-1 text-xs text-slate-500">관련성 {row.relevance.toFixed(0)} · 쇼핑의도 {row.shoppingIntent.toFixed(0)} · 최종 {row.qualityScore.toFixed(1)}</div>
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
      {values.slice(0, 24).map((value) => (
        <span key={value} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">{compactKeywordElonKey(value)}</span>
      ))}
    </div>
  );
}

export default function KeywordElonDemandSummary() {
  const [session, setSession] = useState<KeywordElonLabSession | null>(null);

  useEffect(() => {
    if (window.localStorage.getItem(V5_CACHE_RESET_MARKER) !== "1") {
      const staleKeys: string[] = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith("keywordElon.scoreBridge.")) staleKeys.push(key);
      }
      for (const key of staleKeys) window.localStorage.removeItem(key);
      window.localStorage.setItem(V5_CACHE_RESET_MARKER, "1");
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
    return () => window.clearInterval(timer);
  }, []);

  const safe = useMemo(() => (session?.scoredCandidates ?? []).filter((row) => row.safetyPass === true), [session]);
  const demandTop = useMemo(() => [...safe].filter((row) => row.totalSearch !== null).sort((a, b) => (b.totalSearch ?? -1) - (a.totalSearch ?? -1)).slice(0, 12), [safe]);
  const accuracyTop = useMemo(() => [...safe].sort((a, b) => b.relevance - a.relevance || b.shoppingIntent - a.shoppingIntent || b.specificity - a.specificity).slice(0, 12), [safe]);

  if (!session?.scoredCandidates?.length || session.stage2Status !== "done") return null;
  const measured = safe.filter((row) => row.totalSearch !== null).length;
  const passing = safe.filter((row) => row.qualityScore >= session.cutoff).length;
  const expansionSeeds = session.discovery?.demandExpansionSeeds ?? [];
  const bridgeTerms = session.discovery?.marketBridgeSeeds ?? [];
  const apiHubTerms = session.discovery?.marketTerms ?? [];
  const apiHubMissing = session.discovery?.apiHubConfigured === false;

  return (
    <section className="mx-auto mb-10 mt-[-1rem] max-w-[1500px] px-5 text-slate-900">
      <div className="rounded-2xl border-2 border-violet-200 bg-violet-50/40 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">STEP 2 · MARKET RECALL V5</div>
            <h2 className="mt-1 text-2xl font-black">API HUB 시장어 광산 + SearchAd 수요 진단</h2>
            <p className="mt-2 text-sm text-slate-600">1688 설명형 Seed를 한국 시장 Bridge Seed로 바꾼 뒤 NAVER API HUB 블로그·카페·웹문서에서 반복되는 실제 시장어를 캐고, SearchAd가 월검색량·경쟁을 계측합니다.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-black">
            <span className="rounded-full bg-cyan-100 px-3 py-1 text-cyan-900">Bridge {bridgeTerms.length}개</span>
            <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-900">API HUB 시장어 {apiHubTerms.length}개</span>
            <span className="rounded-full bg-indigo-100 px-3 py-1 text-indigo-900">문서 {session.discovery?.apiHubDocumentCount ?? 0}건</span>
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">안전 Gate {safe.length}개</span>
            <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-800">월검색 측정 {measured}개</span>
            <span className="rounded-full bg-violet-100 px-3 py-1 text-violet-800">최종 {session.cutoff}+ {passing}개</span>
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-white p-4 text-xs leading-6 text-slate-600">
          최종점수 = 월검색수요 55% + 관련성 20% + 쇼핑의도 10% + 경쟁기회 10% + 구체성 5%.
          {expansionSeeds.length ? ` · 2차 SearchAd Seed: ${expansionSeeds.map(compactKeywordElonKey).join(" / ")}` : " · 이번 실행은 2차 수요 Seed가 없었습니다."}
          {session.discovery?.apiHubQueries?.length ? ` · API HUB query: ${session.discovery.apiHubQueries.map(compactKeywordElonKey).join(" / ")}` : ""}
        </div>

        {apiHubMissing ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
            NAVER API HUB 광산이 아직 연결되지 않았습니다. `NAVER_API_HUB_CLIENT_ID / NAVER_API_HUB_CLIENT_SECRET`을 Vercel Production에 넣으면 블로그·카페·웹문서 시장어 수집이 활성화됩니다.
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-cyan-100 bg-cyan-50/50 p-4"><div className="mb-3 text-sm font-black text-cyan-950">Market Bridge Seed</div><TagChips values={bridgeTerms} /></div>
          <div className="rounded-2xl border border-sky-100 bg-sky-50/50 p-4"><div className="mb-3 text-sm font-black text-sky-950">API HUB 반복 시장어</div><TagChips values={apiHubTerms} /></div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div><h3 className="mb-3 text-lg font-black">월검색량 TOP · 검색용 no-space</h3><div className="space-y-2">{demandTop.length ? demandTop.map((row, index) => <KeywordRow key={`demand-${row.searchKey}`} row={row} rank={index + 1} metric="demand" />) : <div className="rounded-xl bg-white p-4 text-sm text-slate-500">측정된 월검색 데이터가 없습니다.</div>}</div></div>
          <div><h3 className="mb-3 text-lg font-black">상품 정확성 TOP</h3><div className="space-y-2">{accuracyTop.map((row, index) => <KeywordRow key={`accuracy-${row.searchKey}`} row={row} rank={index + 1} metric="accuracy" />)}</div></div>
        </div>
      </div>
    </section>
  );
}
