"use client";

import { useEffect, useMemo, useState } from "react";

import {
  KEYWORD_ELON_V2_STORAGE_KEY,
  compactKeywordElonKey,
  uniqueKeywordElonCanonical,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonLabSession,
  type KeywordElonSearchAdStat,
  type KeywordElonTitleResult,
} from "@/lib/keywordEngineElonLabV2";

type ApiRecord = Record<string, unknown> & { ok?: boolean; error?: unknown; errorStage?: unknown };
type Step3Status = "idle" | "discovering" | "scoring" | "title" | "done" | "error";
type Step3Meta = {
  status: Step3Status;
  round: number;
  seedKeywords: string[];
  newCandidateCount: number;
  newPassingCount: number;
  totalPassingCount: number;
  lastMessage: string;
  updatedAt: string;
};
type ExtendedSession = KeywordElonLabSession & { step3?: Step3Meta };

type ExpansionResponse = ApiRecord & {
  discovery: KeywordElonDiscovery;
  seedKeywords: string[];
  round: number;
  newCandidateCount: number;
  apiHubEvidenceCount: number;
  searchAdCandidateCount: number;
  warnings?: string[];
};

type ScoreResponse = ApiRecord & {
  candidates: KeywordElonCandidate[];
  scoringWarnings?: string[];
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
    if (!raw) return null;
    return JSON.parse(raw) as ExtendedSession;
  } catch {
    return null;
  }
}

function writeSession(session: ExtendedSession) {
  window.localStorage.setItem(KEYWORD_ELON_V2_STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent("keyword-elon-session-updated"));
}

function mergeStats(base: KeywordElonSearchAdStat[], added: KeywordElonSearchAdStat[]) {
  const map = new Map<string, KeywordElonSearchAdStat>();
  for (const row of [...base, ...added]) {
    const key = compactKeywordElonKey(row.keyword);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
      continue;
    }
    const sourceSeeds = [...new Set([...(existing.sourceSeeds ?? []), ...(row.sourceSeeds ?? [])])];
    map.set(key, {
      ...((row.totalSearch ?? -1) > (existing.totalSearch ?? -1) ? row : existing),
      sourceSeeds,
    });
  }
  return [...map.values()].sort((a, b) => (b.totalSearch ?? -1) - (a.totalSearch ?? -1));
}

function mergeTags(base: Record<string, string[]>, added: Record<string, string[]>) {
  const result: Record<string, string[]> = { ...base };
  for (const [key, values] of Object.entries(added)) {
    result[key] = [...new Set([...(result[key] ?? []), ...values])];
  }
  return result;
}

function mergeEvidence(
  base: NonNullable<KeywordElonDiscovery["apiHubEvidenceTerms"]>,
  added: NonNullable<KeywordElonDiscovery["apiHubEvidenceTerms"]>,
) {
  const map = new Map<string, (typeof base)[number]>();
  for (const row of [...base, ...added]) {
    const key = compactKeywordElonKey(row.term);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing || row.score > existing.score) map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.score - a.score).slice(0, 160);
}

function mergeDiscovery(base: KeywordElonDiscovery, added: KeywordElonDiscovery): KeywordElonDiscovery {
  return {
    ...base,
    candidates: uniqueKeywordElonCanonical([...base.candidates, ...added.candidates], 900),
    sourceTagsByKeyword: mergeTags(base.sourceTagsByKeyword ?? {}, added.sourceTagsByKeyword ?? {}),
    searchAdStats: mergeStats(base.searchAdStats ?? [], added.searchAdStats ?? []),
    searchAdConfigured: base.searchAdConfigured || added.searchAdConfigured,
    searchAdWarnings: [...new Set([...(base.searchAdWarnings ?? []), ...(added.searchAdWarnings ?? [])])].slice(0, 40),
    aiGeneratedCount: (base.aiGeneratedCount ?? 0) + (added.aiGeneratedCount ?? 0),
    relatedKeywordCount: new Set(
      [...(base.searchAdStats ?? []), ...(added.searchAdStats ?? [])].map((row) => compactKeywordElonKey(row.keyword)),
    ).size,
    demandExpansionSeeds: uniqueKeywordElonCanonical([
      ...(base.demandExpansionSeeds ?? []),
      ...(added.demandExpansionSeeds ?? []),
    ], 20),
    demandExpansionSeedCount: uniqueKeywordElonCanonical([
      ...(base.demandExpansionSeeds ?? []),
      ...(added.demandExpansionSeeds ?? []),
    ], 20).length,
    demandExplorationDepth: Math.max(base.demandExplorationDepth ?? 1, added.demandExplorationDepth ?? 1, 3),
    marketBridgeSeeds: uniqueKeywordElonCanonical([
      ...(base.marketBridgeSeeds ?? []),
      ...(added.marketBridgeSeeds ?? []),
    ], 40),
    marketTerms: uniqueKeywordElonCanonical([...(base.marketTerms ?? []), ...(added.marketTerms ?? [])], 160),
    apiHubConfigured: base.apiHubConfigured || added.apiHubConfigured,
    apiHubQueries: uniqueKeywordElonCanonical([...(base.apiHubQueries ?? []), ...(added.apiHubQueries ?? [])], 40),
    apiHubDocumentCount: (base.apiHubDocumentCount ?? 0) + (added.apiHubDocumentCount ?? 0),
    apiHubActiveSources: [...new Set([...(base.apiHubActiveSources ?? []), ...(added.apiHubActiveSources ?? [])])],
    apiHubEvidenceTerms: mergeEvidence(base.apiHubEvidenceTerms ?? [], added.apiHubEvidenceTerms ?? []),
    trendConfigured: base.trendConfigured || added.trendConfigured,
    trendSignals: [...(base.trendSignals ?? [])],
    trendWarnings: [...new Set([...(base.trendWarnings ?? []), ...(added.trendWarnings ?? [])])].slice(0, 20),
    marketRecallVersion: added.marketRecallVersion || "v6-step3",
    model: added.model || base.model,
  };
}

function mergeCandidates(base: KeywordElonCandidate[], added: KeywordElonCandidate[]) {
  const map = new Map<string, KeywordElonCandidate>();
  for (const row of [...base, ...added]) {
    const key = compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword);
    if (!key) continue;
    const normalized = {
      ...row,
      keyword: key,
      searchKey: key,
      searchKeyword: key,
    } satisfies KeywordElonCandidate;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, normalized);
      continue;
    }
    const chosen = normalized.qualityScore > existing.qualityScore
      ? normalized
      : normalized.qualityScore < existing.qualityScore
        ? existing
        : (normalized.totalSearch ?? -1) > (existing.totalSearch ?? -1)
          ? normalized
          : existing;
    map.set(key, {
      ...chosen,
      sourceTags: [...new Set([...(existing.sourceTags ?? []), ...(normalized.sourceTags ?? [])])],
    });
  }
  return [...map.values()].sort(
    (a, b) =>
      Number(b.safetyPass) - Number(a.safetyPass) ||
      b.qualityScore - a.qualityScore ||
      (b.totalSearch ?? -1) - (a.totalSearch ?? -1),
  );
}

function nextMeta(previous: Step3Meta | undefined, patch: Partial<Step3Meta>): Step3Meta {
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

export default function KeywordElonStep3Expansion() {
  const [session, setSession] = useState<ExtendedSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let last = "";
    const sync = () => {
      const raw = window.localStorage.getItem(KEYWORD_ELON_V2_STORAGE_KEY) || "";
      if (raw === last) return;
      last = raw;
      setSession(readSession());
    };
    sync();
    const timer = window.setInterval(sync, 700);
    const listener = () => sync();
    window.addEventListener("keyword-elon-session-updated", listener);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keyword-elon-session-updated", listener);
    };
  }, []);

  const passing = useMemo(
    () => (session?.scoredCandidates ?? [])
      .filter((row) => row.safetyPass && row.qualityScore >= (session?.cutoff ?? 70))
      .sort((a, b) => b.qualityScore - a.qualityScore || (b.totalSearch ?? -1) - (a.totalSearch ?? -1)),
    [session],
  );
  const seeds = useMemo(
    () => uniqueKeywordElonCanonical(
      passing.map((row) => row.searchKeyword || row.searchKey || row.keyword),
      8,
    ),
    [passing],
  );

  if (!session || session.stage2Status !== "done" || !session.identity || !session.discovery) return null;

  async function runStep3() {
    if (!session.identity || !session.discovery || !seeds.length || busy) return;
    const source = session.source;
    const identity = session.identity;
    const cutoff = session.cutoff;
    const round = (session.step3?.round ?? 0) + 1;
    setBusy(true);
    setError("");
    setMessage(`STEP 3 round ${round} · 통과키워드 ${seeds.join(" / ")}에서 추가발굴 중…`);
    const started: ExtendedSession = {
      ...session,
      step3: nextMeta(session.step3, {
        status: "discovering",
        round,
        seedKeywords: seeds,
        lastMessage: `통과키워드 ${seeds.length}개로 추가발굴 중`,
      }),
      updatedAt: new Date().toISOString(),
    };
    writeSession(started);
    setSession(started);

    try {
      const expanded = await requestLab<ExpansionResponse>({
        action: "expand_from_passing",
        identity,
        seedKeywords: seeds,
        existingDiscovery: session.discovery,
        existingCandidates: session.scoredCandidates,
        round,
      });
      if (!expanded.newCandidateCount || !expanded.discovery.candidates.length) {
        const noNew: ExtendedSession = {
          ...started,
          step3: nextMeta(started.step3, {
            status: "done",
            newCandidateCount: 0,
            newPassingCount: 0,
            totalPassingCount: passing.length,
            lastMessage: "기존 후보를 제외한 신규 키워드가 없습니다.",
          }),
          lastMessage: "STEP 3 완료 · 기존 후보를 제외한 신규 키워드가 없습니다.",
          updatedAt: new Date().toISOString(),
        };
        writeSession(noNew);
        setSession(noNew);
        setMessage(noNew.lastMessage);
        return;
      }

      setMessage(`신규 후보 ${expanded.newCandidateCount}개 확보 · AI 안전 Gate와 수요점수 계산 중…`);
      const scoringSession: ExtendedSession = {
        ...started,
        step3: nextMeta(started.step3, {
          status: "scoring",
          newCandidateCount: expanded.newCandidateCount,
          lastMessage: `신규 후보 ${expanded.newCandidateCount}개 점수화 중`,
        }),
      };
      writeSession(scoringSession);
      setSession(scoringSession);

      const scored = await requestLab<ScoreResponse>({
        action: "score_keywords",
        source,
        identity,
        discovery: expanded.discovery,
      });
      const mergedCandidates = mergeCandidates(session.scoredCandidates, scored.candidates);
      const mergedDiscovery = mergeDiscovery(session.discovery, expanded.discovery);
      const previousKeys = new Set(session.scoredCandidates.map((row) => compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword)));
      const newlyPassed = scored.candidates.filter(
        (row) => row.safetyPass && row.qualityScore >= cutoff && !previousKeys.has(compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword)),
      );
      const totalPassing = mergedCandidates.filter((row) => row.safetyPass && row.qualityScore >= cutoff).length;

      setMessage(`신규 통과 ${newlyPassed.length}개 · 전체 통과 ${totalPassing}개 · 상품명 재조립 중…`);
      const titleResponse = await requestLab<ApiRecord & { titleResult: KeywordElonTitleResult }>({
        action: "generate_title",
        source,
        identity,
        candidates: mergedCandidates,
        cutoff,
      });

      const completed: ExtendedSession = {
        ...session,
        discovery: mergedDiscovery,
        scoredCandidates: mergedCandidates,
        titleResult: titleResponse.titleResult,
        stage2Status: "done",
        step3: nextMeta(session.step3, {
          status: "done",
          round,
          seedKeywords: expanded.seedKeywords,
          newCandidateCount: expanded.newCandidateCount,
          newPassingCount: newlyPassed.length,
          totalPassingCount: totalPassing,
          lastMessage: `round ${round} 완료 · 신규 후보 ${expanded.newCandidateCount}개 · 신규 통과 ${newlyPassed.length}개`,
        }),
        lastMessage: `STEP 3 round ${round} 완료 · 신규 통과 ${newlyPassed.length}개 · 전체 ${cutoff}점 이상 ${totalPassing}개`,
        updatedAt: new Date().toISOString(),
      };
      writeSession(completed);
      setSession(completed);
      setMessage(completed.lastMessage);
      window.setTimeout(() => window.location.reload(), 900);
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "STEP 3 추가발굴 실패";
      const failed: ExtendedSession = {
        ...session,
        step3: nextMeta(session.step3, {
          status: "error",
          round,
          seedKeywords: seeds,
          lastMessage: detail,
        }),
        lastMessage: detail,
        updatedAt: new Date().toISOString(),
      };
      writeSession(failed);
      setSession(failed);
      setError(detail);
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto mb-8 max-w-[1500px] px-5 text-slate-900">
      <div className="rounded-2xl border-2 border-fuchsia-200 bg-fuchsia-50/50 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-fuchsia-700">STEP 3 · PASSING KEYWORD EXPANSION</div>
            <h2 className="mt-1 text-2xl font-black">통과키워드에서 추가 시장어 발굴</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              STEP 2에서 이미 상품 동일성과 구매의도를 통과한 키워드를 새 광산 Seed로 사용합니다. API HUB Evidence와 SearchAd 연관어를 다시 수집하고, 기존 후보는 제외한 신규 키워드만 점수화해 합칩니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-black">
            <span className="rounded-full bg-white px-3 py-1 text-fuchsia-900 ring-1 ring-fuchsia-200">현재 통과 {passing.length}개</span>
            <span className="rounded-full bg-white px-3 py-1 text-fuchsia-900 ring-1 ring-fuchsia-200">Seed {seeds.length}개</span>
            <span className="rounded-full bg-white px-3 py-1 text-fuchsia-900 ring-1 ring-fuchsia-200">완료 round {session.step3?.round ?? 0}</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {seeds.map((seed) => (
            <span key={seed} className="rounded-full bg-white px-3 py-1 text-sm font-black text-slate-800 ring-1 ring-slate-200">{seed}</span>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || !seeds.length}
            onClick={runStep3}
            className="rounded-xl bg-fuchsia-600 px-5 py-3 text-sm font-black text-white disabled:opacity-40"
          >
            {busy ? "STEP 3 실행 중…" : `STEP 3 · 통과키워드로 추가발굴${session.step3?.round ? ` round ${session.step3.round + 1}` : ""}`}
          </button>
          <span className="text-sm text-slate-500">한 번에 Seed 최대 8개 · 신규 후보 최대 300개 · 기존 후보 자동 제외</span>
        </div>

        {message ? <div className="mt-4 rounded-xl bg-white px-4 py-3 text-sm font-bold text-fuchsia-950 ring-1 ring-fuchsia-100">{message}</div> : null}
        {error ? <div className="mt-4 whitespace-pre-wrap rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 font-mono text-xs leading-6 text-rose-900">{error}</div> : null}
        {session.step3?.status === "done" ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-white p-4"><div className="text-xs font-bold text-slate-500">최근 신규 후보</div><div className="mt-1 text-2xl font-black">{session.step3.newCandidateCount}</div></div>
            <div className="rounded-xl bg-white p-4"><div className="text-xs font-bold text-slate-500">최근 신규 통과</div><div className="mt-1 text-2xl font-black text-emerald-700">{session.step3.newPassingCount}</div></div>
            <div className="rounded-xl bg-white p-4"><div className="text-xs font-bold text-slate-500">전체 통과</div><div className="mt-1 text-2xl font-black">{session.step3.totalPassingCount}</div></div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
