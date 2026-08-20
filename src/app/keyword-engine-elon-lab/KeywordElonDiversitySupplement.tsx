"use client";

import { useEffect, useMemo, useState } from "react";

import {
  KEYWORD_ELON_V2_STORAGE_KEY,
  compactKeywordElonKey,
  uniqueKeywordElonCanonical,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonLabSession,
} from "@/lib/keywordEngineElonLabV2";
import type { KeywordElonStep4FilterResult } from "@/lib/keywordEngineElonLabV2Step4";

const CUSTOM_BLOCKED_STORAGE_KEY = "keywordEngineElonLab.step4.customBlockedTerms.v1";
const DIVERSITY_CACHE_KEY = "keywordEngineElonLab.step4.diversitySupplement.v1";
const OBSERVED_LIMIT = 30;
const GENERATED_LIMIT = 20;

type ApiRecord = Record<string, unknown> & { ok?: boolean; error?: unknown; errorStage?: unknown };
type Step3Meta = { status: string; round: number };
type Step4Meta = KeywordElonStep4FilterResult & {
  status: "running" | "done" | "error";
  inputFingerprint: string;
  customBlockedTerms: string[];
  updatedAt: string;
};
type ExtendedSession = KeywordElonLabSession & { step3?: Step3Meta; step4?: Step4Meta };
type DiversityCache = {
  fingerprint: string;
  observedAllowedKeys: string[];
  observedRemovedCount: number;
  generatedCandidates: KeywordElonCandidate[];
  generatedAllowedKeys: string[];
  generatedRemovedCount: number;
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

function readCache() {
  try {
    const raw = window.localStorage.getItem(DIVERSITY_CACHE_KEY);
    return raw ? JSON.parse(raw) as DiversityCache : null;
  } catch {
    return null;
  }
}

function writeCache(cache: DiversityCache) {
  window.localStorage.setItem(DIVERSITY_CACHE_KEY, JSON.stringify(cache));
}

function candidateKey(row: KeywordElonCandidate) {
  return compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword);
}

function candidateLabel(row: KeywordElonCandidate) {
  return row.searchKeyword || row.searchKey || row.keyword;
}

function buildFingerprint(session: ExtendedSession) {
  return [
    session.source.offerId || session.source.url,
    `cutoff:${session.cutoff}`,
    `step3:${session.step3?.round ?? 0}`,
    `step4:${session.step4?.updatedAt ?? ""}`,
    `custom:${readCustomBlockedTerms().join(",")}`,
  ].join("|");
}

function emptyCache(fingerprint: string): DiversityCache {
  return {
    fingerprint,
    observedAllowedKeys: [],
    observedRemovedCount: 0,
    generatedCandidates: [],
    generatedAllowedKeys: [],
    generatedRemovedCount: 0,
  };
}

function KeywordCard({ row, label }: { row: KeywordElonCandidate; label: string }) {
  return (
    <div className="rounded-xl border border-cyan-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-black text-slate-900">{candidateLabel(row)}</div>
          <div className="mt-1 text-xs text-slate-500">
            관련성 {row.relevance.toFixed(0)} · 쇼핑의도 {row.shoppingIntent.toFixed(0)} · 품질 {row.qualityScore.toFixed(1)}
          </div>
        </div>
        <div className="text-right">
          <div className="font-black tabular-nums">{row.totalSearch === null ? "—" : row.totalSearch.toLocaleString()}</div>
          <div className="text-[11px] text-slate-400">월검색</div>
        </div>
      </div>
      <div className="mt-2 inline-block rounded-full bg-cyan-100 px-2.5 py-1 text-[11px] font-black text-cyan-900">{label}</div>
    </div>
  );
}

export default function KeywordElonDiversitySupplement() {
  const [session, setSession] = useState<ExtendedSession | null>(null);
  const [cache, setCache] = useState<DiversityCache | null>(null);
  const [busyObserved, setBusyObserved] = useState(false);
  const [busyGenerated, setBusyGenerated] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

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

  const coreKeys = useMemo(
    () => new Set(session?.step4?.status === "done" ? session.step4.allowedKeys : []),
    [session],
  );
  const safeCandidates = useMemo(
    () => (session?.scoredCandidates ?? []).filter((row) => row.safetyPass && row.titleEligible),
    [session],
  );
  const demandTopKeys = useMemo(
    () => new Set(
      [...safeCandidates]
        .filter((row) => row.totalSearch !== null)
        .sort((a, b) => (b.totalSearch ?? -1) - (a.totalSearch ?? -1))
        .slice(0, 12)
        .map(candidateKey),
    ),
    [safeCandidates],
  );
  const accuracyTopKeys = useMemo(
    () => new Set(
      [...safeCandidates]
        .sort((a, b) => b.relevance - a.relevance || b.shoppingIntent - a.shoppingIntent || b.specificity - a.specificity)
        .slice(0, 12)
        .map(candidateKey),
    ),
    [safeCandidates],
  );
  const topKeys = useMemo(
    () => new Set([...demandTopKeys, ...accuracyTopKeys]),
    [demandTopKeys, accuracyTopKeys],
  );
  const observedCandidates = useMemo(() => {
    const eligible = safeCandidates
      .filter((row) => !coreKeys.has(candidateKey(row)))
      .filter((row) => row.relevance >= 80 && row.shoppingIntent >= 70);
    const outsideTop = eligible
      .filter((row) => !topKeys.has(candidateKey(row)))
      .sort((a, b) => b.relevance - a.relevance || b.shoppingIntent - a.shoppingIntent || b.qualityScore - a.qualityScore || (b.totalSearch ?? -1) - (a.totalSearch ?? -1));
    const remaining = eligible
      .filter((row) => topKeys.has(candidateKey(row)))
      .sort((a, b) => b.relevance - a.relevance || b.shoppingIntent - a.shoppingIntent || b.qualityScore - a.qualityScore || (b.totalSearch ?? -1) - (a.totalSearch ?? -1));
    return [...outsideTop, ...remaining].slice(0, OBSERVED_LIMIT);
  }, [safeCandidates, coreKeys, topKeys]);
  const fingerprint = useMemo(() => session ? buildFingerprint(session) : "", [session]);
  const observedMap = useMemo(
    () => new Map(observedCandidates.map((row) => [candidateKey(row), row] as const)),
    [observedCandidates],
  );
  const observedAllowed = useMemo(
    () => (cache?.fingerprint === fingerprint ? cache.observedAllowedKeys : [])
      .map((key) => observedMap.get(key))
      .filter((row): row is KeywordElonCandidate => Boolean(row)),
    [cache, fingerprint, observedMap],
  );
  const generatedMap = useMemo(
    () => new Map((cache?.generatedCandidates ?? []).map((row) => [candidateKey(row), row] as const)),
    [cache],
  );
  const generatedAllowed = useMemo(
    () => (cache?.fingerprint === fingerprint ? cache.generatedAllowedKeys : [])
      .map((key) => generatedMap.get(key))
      .filter((row): row is KeywordElonCandidate => Boolean(row)),
    [cache, fingerprint, generatedMap],
  );

  useEffect(() => {
    if (!session || session.step4?.status !== "done" || !session.identity || !fingerprint) return;
    const timer = window.setTimeout(() => {
      const saved = readCache();
      if (saved?.fingerprint === fingerprint) {
        setCache(saved);
        return;
      }
      if (!observedCandidates.length || busyObserved) {
        setCache(emptyCache(fingerprint));
        return;
      }
      setBusyObserved(true);
      setError("");
      void requestLab<ApiRecord & { result: KeywordElonStep4FilterResult }>({
        action: "filter_prohibited_keywords",
        identity: session.identity,
        candidates: observedCandidates,
        customBlockedTerms: readCustomBlockedTerms(),
      })
        .then((filtered) => {
          const next: DiversityCache = {
            ...emptyCache(fingerprint),
            observedAllowedKeys: filtered.result.allowedKeys,
            observedRemovedCount: filtered.result.removedCount,
          };
          writeCache(next);
          setCache(next);
          setMessage(`실측 보조 후보 ${observedCandidates.length}개 중 STEP 4 통과 ${filtered.result.allowedCount}개를 확보했습니다.`);
        })
        .catch((caught) => {
          setError(caught instanceof Error ? caught.message : "다양성 보조 후보 검사 실패");
        })
        .finally(() => setBusyObserved(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [session, fingerprint, observedCandidates, busyObserved]);

  async function generateMore() {
    if (!session?.identity || !session.discovery || busyGenerated) return;
    setBusyGenerated(true);
    setError("");
    setMessage("추가 시장/AI 후보를 발굴하고 기존 키워드와 중복을 제거하는 중…");
    try {
      const discovered = await requestLab<ApiRecord & { discovery: KeywordElonDiscovery }>({
        action: "discover_keywords",
        source: session.source,
        identity: session.identity,
      });
      const scored = await requestLab<ApiRecord & { candidates: KeywordElonCandidate[] }>({
        action: "score_keywords",
        source: session.source,
        identity: session.identity,
        discovery: discovered.discovery,
      });
      const existingKeys = new Set((session.scoredCandidates ?? []).map(candidateKey));
      const generated = scored.candidates
        .filter((row) => row.safetyPass && row.titleEligible)
        .filter((row) => row.relevance >= 80 && row.shoppingIntent >= 70)
        .filter((row) => !existingKeys.has(candidateKey(row)))
        .sort((a, b) => b.relevance - a.relevance || b.shoppingIntent - a.shoppingIntent || b.specificity - a.specificity || b.qualityScore - a.qualityScore)
        .slice(0, GENERATED_LIMIT);

      if (!generated.length) {
        setMessage("추가 탐색에서 기존 후보와 겹치지 않는 안전한 보조 키워드를 찾지 못했습니다.");
        return;
      }
      const filtered = await requestLab<ApiRecord & { result: KeywordElonStep4FilterResult }>({
        action: "filter_prohibited_keywords",
        identity: session.identity,
        candidates: generated,
        customBlockedTerms: readCustomBlockedTerms(),
      });
      const current = cache?.fingerprint === fingerprint ? cache : emptyCache(fingerprint);
      const next: DiversityCache = {
        ...current,
        generatedCandidates: generated,
        generatedAllowedKeys: filtered.result.allowedKeys,
        generatedRemovedCount: filtered.result.removedCount,
      };
      writeCache(next);
      setCache(next);
      setMessage(`추가 탐색 후보 ${generated.length}개 중 STEP 4 통과 ${filtered.result.allowedCount}개를 추가했습니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "추가 다양성 후보 발굴 실패");
    } finally {
      setBusyGenerated(false);
    }
  }

  if (!session || session.step4?.status !== "done" || !session.identity) return null;

  return (
    <section className="mx-auto mb-10 mt-[-1rem] max-w-[1500px] px-5 text-slate-900">
      <div className="rounded-2xl border-2 border-cyan-200 bg-cyan-50/50 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-cyan-700">DIVERSITY SUPPLEMENT · AFTER STEP 4</div>
            <h2 className="mt-1 text-2xl font-black">다양성 보조 키워드</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              핵심 최종 키워드와 분리된 보조 풀입니다. 먼저 실제 수집·점수화됐지만 최종 70점 커트/상위 랭킹 밖에 남은 안전 후보를 STEP 4 위험필터로 다시 거릅니다. 부족하면 추가 시장·AI 탐색을 선택적으로 실행할 수 있습니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-black">
            <span className="rounded-full bg-white px-3 py-1 text-cyan-900 ring-1 ring-cyan-200">핵심 최종 {coreKeys.size}개</span>
            <span className="rounded-full bg-white px-3 py-1 text-cyan-900 ring-1 ring-cyan-200">실측 보조 {observedAllowed.length}개</span>
            <span className="rounded-full bg-white px-3 py-1 text-cyan-900 ring-1 ring-cyan-200">추가 탐색 {generatedAllowed.length}개</span>
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-white p-4 text-xs leading-6 text-slate-600">
          원칙: <b>핵심 키워드는 정확성+수요 기준을 유지</b>하고, 아래 보조 키워드는 다양성 확보용으로만 제공합니다. 현재 상품명 생성에는 자동으로 섞지 않습니다. 실제 수집 후보를 우선 사용하고 추가 탐색은 필요할 때만 실행해 비용을 줄입니다.
        </div>

        {busyObserved ? <div className="mt-4 rounded-xl bg-white px-4 py-3 text-sm font-bold text-cyan-950">기존 후보 중 STEP 4 통과 가능한 다양성 보조 키워드를 선별 중…</div> : null}
        {message ? <div className="mt-4 rounded-xl bg-white px-4 py-3 text-sm font-bold text-cyan-950">{message}</div> : null}
        {error ? <div className="mt-4 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">{error}</div> : null}

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-black">실제 수집에서 건진 보조 키워드</h3>
              <span className="text-xs text-slate-500">위험필터 제거 {cache?.observedRemovedCount ?? 0}개</span>
            </div>
            <div className="mt-3 space-y-2">
              {observedAllowed.length ? observedAllowed.map((row) => (
                <KeywordCard key={`observed-${candidateKey(row)}`} row={row} label={topKeys.has(candidateKey(row)) ? "커트라인 밖 실측" : "TOP 밖 실측"} />
              )) : (
                <div className="rounded-xl bg-white p-4 text-sm text-slate-500">현재 실측 후보에서는 추가 보조 키워드가 없습니다.</div>
              )}
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-black">추가 시장·AI 보조 후보</h3>
              <button
                type="button"
                disabled={busyGenerated}
                onClick={generateMore}
                className="rounded-lg bg-cyan-700 px-4 py-2 text-xs font-black text-white disabled:opacity-40"
              >
                {busyGenerated ? "추가 탐색 중…" : "보조 키워드 더 찾기"}
              </button>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">실측 보조가 부족할 때만 사용하세요. 새 후보도 관련성·쇼핑의도 Gate와 STEP 4 금지키워드 검사를 모두 통과해야 표시됩니다.</p>
            <div className="mt-3 space-y-2">
              {generatedAllowed.length ? generatedAllowed.map((row) => (
                <KeywordCard key={`generated-${candidateKey(row)}`} row={row} label="추가 시장·AI 탐색" />
              )) : (
                <div className="rounded-xl bg-white p-4 text-sm text-slate-500">아직 추가 탐색을 실행하지 않았거나 새로운 안전 후보가 없습니다.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
