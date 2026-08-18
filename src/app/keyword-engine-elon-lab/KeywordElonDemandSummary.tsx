"use client";

import { useEffect, useMemo, useState } from "react";

import {
  KEYWORD_ELON_V2_RELEVANCE_GATE,
  KEYWORD_ELON_V2_SHOPPING_INTENT_GATE,
  KEYWORD_ELON_V2_STORAGE_KEY,
  type KeywordElonCandidate,
  type KeywordElonLabSession,
} from "@/lib/keywordEngineElonLabV2";

const DEMAND_FIRST_CACHE_RESET_MARKER = "keywordElon.demandFirstV3.cacheReset";

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
        <span className="font-black">{row.keyword}</span>
        <div className="mt-1 text-xs text-slate-500">
          관련성 {row.relevance.toFixed(0)} · 쇼핑의도 {row.shoppingIntent.toFixed(0)} · 최종 {row.qualityScore.toFixed(1)}
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

export default function KeywordElonDemandSummary() {
  const [session, setSession] = useState<KeywordElonLabSession | null>(null);

  useEffect(() => {
    if (window.localStorage.getItem(DEMAND_FIRST_CACHE_RESET_MARKER) !== "1") {
      const staleKeys: string[] = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith("keywordElon.scoreBridge.v2:")) staleKeys.push(key);
      }
      for (const key of staleKeys) window.localStorage.removeItem(key);
      window.localStorage.setItem(DEMAND_FIRST_CACHE_RESET_MARKER, "1");
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

  const safe = useMemo(
    () => (session?.scoredCandidates ?? []).filter((row) => row.safetyPass === true),
    [session],
  );
  const demandTop = useMemo(
    () => [...safe].filter((row) => row.totalSearch !== null).sort((a, b) => (b.totalSearch ?? -1) - (a.totalSearch ?? -1)).slice(0, 10),
    [safe],
  );
  const accuracyTop = useMemo(
    () => [...safe].sort((a, b) => b.relevance - a.relevance || b.shoppingIntent - a.shoppingIntent || b.specificity - a.specificity).slice(0, 10),
    [safe],
  );

  if (!session?.scoredCandidates?.length || session.stage2Status !== "done") return null;
  const measured = safe.filter((row) => row.totalSearch !== null).length;
  const passing = safe.filter((row) => row.qualityScore >= session.cutoff).length;
  const expansionSeeds = session.discovery?.demandExpansionSeeds ?? [];

  return (
    <section className="mx-auto mb-10 mt-[-1rem] max-w-[1500px] px-5 text-slate-900">
      <div className="rounded-2xl border-2 border-violet-200 bg-violet-50/40 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">STEP 2 · DEMAND-FIRST V3</div>
            <h2 className="mt-1 text-2xl font-black">월검색수요 중심 진단</h2>
            <p className="mt-2 text-sm text-slate-600">
              관련성 {KEYWORD_ELON_V2_RELEVANCE_GATE}+ · 쇼핑의도 {KEYWORD_ELON_V2_SHOPPING_INTENT_GATE}+를 먼저 통과한 키워드만 수요 경쟁에 참여합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-black">
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">안전 Gate {safe.length}개</span>
            <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-800">월검색 측정 {measured}개</span>
            <span className="rounded-full bg-violet-100 px-3 py-1 text-violet-800">최종 {session.cutoff}+ {passing}개</span>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">수요 재탐색 depth {session.discovery?.demandExplorationDepth ?? 1}</span>
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-white p-4 text-xs leading-6 text-slate-600">
          최종점수 = 월검색수요 55% + 관련성 20% + 쇼핑의도 10% + 경쟁기회 10% + 구체성 5%.
          {expansionSeeds.length ? ` · 2차 SearchAd Seed: ${expansionSeeds.join(" / ")}` : " · 이번 실행은 2차 수요 Seed가 없었습니다."}
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 text-lg font-black">월검색량 TOP</h3>
            <div className="space-y-2">
              {demandTop.length ? demandTop.map((row, index) => <KeywordRow key={`demand-${row.searchKey}`} row={row} rank={index + 1} metric="demand" />) : <div className="rounded-xl bg-white p-4 text-sm text-slate-500">측정된 월검색 데이터가 없습니다.</div>}
            </div>
          </div>
          <div>
            <h3 className="mb-3 text-lg font-black">상품 정확성 TOP</h3>
            <div className="space-y-2">
              {accuracyTop.map((row, index) => <KeywordRow key={`accuracy-${row.searchKey}`} row={row} rank={index + 1} metric="accuracy" />)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
