"use client";

import { useEffect, useState } from "react";

import {
  KEYWORD_ELON_V2_STORAGE_KEY,
  compactKeywordElonKey,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonSearchAdStat,
} from "@/lib/keywordEngineElonLabV2";

const SCORE_CLIENT_CHUNK_SIZE = 20;
const SCORE_CACHE_PREFIX = "keywordElon.scoreBridge.v1";

type BridgeProgress = {
  active: boolean;
  done: number;
  total: number;
  scored: number;
  message: string;
  error: string;
};

type CachedChunk = {
  keys: string[];
  candidates: KeywordElonCandidate[];
  warnings: string[];
};

type ScoreCache = {
  version: 1;
  fingerprint: string;
  updatedAt: string;
  chunks: Record<string, CachedChunk>;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function simpleHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function urlString(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function readJsonBody(init?: RequestInit) {
  if (typeof init?.body !== "string") return null;
  try {
    return JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function discoveryFrom(value: unknown): KeywordElonDiscovery | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const discovery = value as KeywordElonDiscovery;
  return Array.isArray(discovery.candidates) ? discovery : null;
}

function cacheKey(body: Record<string, unknown>, discovery: KeywordElonDiscovery) {
  const source = body.source && typeof body.source === "object" ? body.source as Record<string, unknown> : {};
  const identity = body.identity && typeof body.identity === "object" ? body.identity as Record<string, unknown> : {};
  const fingerprint = simpleHash(JSON.stringify({
    url: source.url ?? "",
    offerId: source.offerId ?? "",
    coreProduct: identity.coreProduct ?? "",
    identityAnchor: identity.identityAnchor ?? "",
    candidates: discovery.candidates,
  }));
  return { fingerprint, key: `${SCORE_CACHE_PREFIX}:${fingerprint}` };
}

function loadCache(key: string, fingerprint: string): ScoreCache {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) throw new Error("empty");
    const parsed = JSON.parse(raw) as ScoreCache;
    if (parsed.version !== 1 || parsed.fingerprint !== fingerprint || !parsed.chunks) throw new Error("stale");
    return parsed;
  } catch {
    return { version: 1, fingerprint, updatedAt: new Date().toISOString(), chunks: {} };
  }
}

function saveCache(key: string, cache: ScoreCache) {
  cache.updatedAt = new Date().toISOString();
  window.localStorage.setItem(key, JSON.stringify(cache));
}

function sessionDiscoveryForResume() {
  try {
    const raw = window.localStorage.getItem(KEYWORD_ELON_V2_STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as {
      stage2Status?: string;
      discovery?: KeywordElonDiscovery | null;
      scoredCandidates?: unknown[];
    };
    if (session.stage2Status !== "error" || !session.discovery?.candidates?.length) return null;
    if ((session.scoredCandidates?.length ?? 0) >= session.discovery.candidates.length) return null;
    return session.discovery;
  } catch {
    return null;
  }
}

function filterDiscovery(discovery: KeywordElonDiscovery, chunk: string[]): KeywordElonDiscovery {
  const keys = new Set(chunk.map(compactKeywordElonKey));
  const sourceTagsByKeyword = Object.fromEntries(
    Object.entries(discovery.sourceTagsByKeyword ?? {}).filter(([key]) => keys.has(compactKeywordElonKey(key))),
  );
  const searchAdStats = (discovery.searchAdStats ?? []).filter((row: KeywordElonSearchAdStat) =>
    keys.has(compactKeywordElonKey(row.keyword)),
  );
  return {
    ...discovery,
    candidates: chunk,
    sourceTagsByKeyword,
    searchAdStats,
  };
}

function errorResponse(message: string, status = 500) {
  return new Response(JSON.stringify({
    ok: false,
    errorStage: "score_keywords_chunk",
    error: message,
  }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default function KeywordElonScoreFetchBridge() {
  const [progress, setProgress] = useState<BridgeProgress>({
    active: false,
    done: 0,
    total: 0,
    scored: 0,
    message: "",
    error: "",
  });

  useEffect(() => {
    const nativeFetch = window.fetch.bind(window);

    const bridgedFetch: typeof window.fetch = async (input, init) => {
      const url = urlString(input);
      if (!url.includes("/api/keyword-engine-elon-lab")) return nativeFetch(input, init);
      const body = readJsonBody(init);
      const action = typeof body?.action === "string" ? body.action : "";

      if (action === "discover_keywords") {
        const existing = sessionDiscoveryForResume();
        if (existing) {
          setProgress((previous) => ({
            ...previous,
            message: `이전 후보 ${existing.candidates.length}개를 재사용해 SearchAd 재호출 없이 점수화를 재개합니다.`,
            error: "",
          }));
          return new Response(JSON.stringify({ ok: true, action, discovery: existing, resumed: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return nativeFetch(input, init);
      }

      if (action !== "score_keywords") return nativeFetch(input, init);
      const discovery = discoveryFrom(body?.discovery);
      if (!body || !discovery || discovery.candidates.length <= SCORE_CLIENT_CHUNK_SIZE) {
        return nativeFetch(input, init);
      }

      const { fingerprint, key } = cacheKey(body, discovery);
      const cache = loadCache(key, fingerprint);
      const chunks: string[][] = [];
      for (let index = 0; index < discovery.candidates.length; index += SCORE_CLIENT_CHUNK_SIZE) {
        chunks.push(discovery.candidates.slice(index, index + SCORE_CLIENT_CHUNK_SIZE));
      }

      let scoredCount = Object.values(cache.chunks).reduce((sum, chunk) => sum + chunk.candidates.length, 0);
      setProgress({
        active: true,
        done: Object.keys(cache.chunks).length,
        total: chunks.length,
        scored: scoredCount,
        message: "AI 품질점수를 작은 요청으로 나눠 실행합니다.",
        error: "",
      });

      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        const chunkKeys = chunk.map(compactKeywordElonKey);
        const cached = cache.chunks[String(index)];
        if (cached && JSON.stringify(cached.keys) === JSON.stringify(chunkKeys)) {
          setProgress((previous) => ({
            ...previous,
            done: Math.max(previous.done, index + 1),
            scored: Object.values(cache.chunks).reduce((sum, row) => sum + row.candidates.length, 0),
            message: `저장된 점수 결과를 재사용 중 · ${index + 1}/${chunks.length}`,
          }));
          continue;
        }

        const chunkDiscovery = filterDiscovery(discovery, chunk);
        const chunkBody = { ...body, discovery: chunkDiscovery };
        setProgress((previous) => ({
          ...previous,
          message: `AI 점수화 ${index + 1}/${chunks.length} · ${chunk.length}개 처리 중`,
        }));

        const response = await nativeFetch(input, {
          ...init,
          body: JSON.stringify(chunkBody),
        });
        const raw = await response.text();
        let payload: Record<string, unknown> | null = null;
        try {
          payload = raw ? JSON.parse(raw) as Record<string, unknown> : null;
        } catch {
          const message = `[score_keywords_chunk ${index + 1}/${chunks.length}] HTTP ${response.status} · JSON이 아닌 응답: ${raw.slice(0, 220)}`;
          setProgress((previous) => ({ ...previous, active: false, error: message, message: "분할 점수화가 중단됐습니다. 다시 실행하면 완료 지점부터 재개합니다." }));
          return errorResponse(message, response.status || 500);
        }
        if (!response.ok || payload?.ok !== true || !Array.isArray(payload.candidates)) {
          const detail = typeof payload?.error === "string" ? payload.error : `HTTP ${response.status}`;
          const message = `[score_keywords_chunk ${index + 1}/${chunks.length}] ${detail}`;
          setProgress((previous) => ({ ...previous, active: false, error: message, message: "분할 점수화가 중단됐습니다. 다시 실행하면 완료 지점부터 재개합니다." }));
          return errorResponse(message, response.status || 500);
        }

        cache.chunks[String(index)] = {
          keys: chunkKeys,
          candidates: payload.candidates as KeywordElonCandidate[],
          warnings: Array.isArray(payload.scoringWarnings)
            ? payload.scoringWarnings.filter((value): value is string => typeof value === "string")
            : [],
        };
        saveCache(key, cache);
        scoredCount = Object.values(cache.chunks).reduce((sum, row) => sum + row.candidates.length, 0);
        setProgress({
          active: true,
          done: index + 1,
          total: chunks.length,
          scored: scoredCount,
          message: `AI 점수화 진행 · ${index + 1}/${chunks.length} · ${scoredCount}/${discovery.candidates.length}개 저장`,
          error: "",
        });
        await sleep(250);
      }

      const merged = chunks.flatMap((_, index) => cache.chunks[String(index)]?.candidates ?? []);
      merged.sort((a, b) => b.qualityScore - a.qualityScore || (b.totalSearch ?? -1) - (a.totalSearch ?? -1));
      const warnings = [...new Set(Object.values(cache.chunks).flatMap((chunk) => chunk.warnings))].slice(0, 10);
      setProgress({
        active: false,
        done: chunks.length,
        total: chunks.length,
        scored: merged.length,
        message: `AI 점수화 완료 · ${merged.length}/${discovery.candidates.length}개`,
        error: "",
      });
      window.setTimeout(() => {
        setProgress((previous) => previous.error ? previous : { ...previous, message: "" });
      }, 5000);

      return new Response(JSON.stringify({
        ok: true,
        action: "score_keywords",
        candidates: merged,
        scoringWarnings: warnings,
        scoringChunkCount: chunks.length,
        scoringSuccessfulChunks: chunks.length,
        clientChunked: true,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    window.fetch = bridgedFetch;
    return () => {
      if (window.fetch === bridgedFetch) window.fetch = nativeFetch;
    };
  }, []);

  if (!progress.active && !progress.message && !progress.error) return null;
  return (
    <div className={`fixed bottom-5 left-5 z-[9999] w-[360px] max-w-[calc(100vw-2.5rem)] rounded-2xl border p-4 shadow-xl ${progress.error ? "border-rose-300 bg-rose-50 text-rose-950" : "border-violet-200 bg-white text-slate-900"}`}>
      <div className="text-xs font-black uppercase tracking-[0.12em]">Keyword Lab · 분할 점수화</div>
      <div className="mt-2 text-sm font-bold">{progress.error || progress.message}</div>
      {progress.total > 0 ? (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs font-bold">
            <span>{progress.done}/{progress.total} 묶음</span>
            <span>{progress.scored}개 저장</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-violet-600 transition-all" style={{ width: `${Math.min(100, (progress.done / progress.total) * 100)}%` }} />
          </div>
        </div>
      ) : null}
      {progress.error ? <div className="mt-2 text-xs">STEP 2를 다시 누르면 완료된 묶음은 건너뛰고 실패 지점부터 재개합니다.</div> : null}
    </div>
  );
}
