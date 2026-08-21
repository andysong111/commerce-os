"use client";

import { useEffect, useState } from "react";

import {
  KEYWORD_ELON_V2_STORAGE_KEY,
  compactKeywordElonKey,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonSearchAdStat,
} from "@/lib/keywordEngineElonLabV2";

const SCORE_CLIENT_CHUNK_SIZE = 12;
const SCORE_MIN_ADAPTIVE_CHUNK_SIZE = 3;
const SCORE_CACHE_PREFIX = "keywordElon.scoreBridge.v3.marketRecall";
const SCORE_CACHE_FAMILY_PREFIX = "keywordElon.scoreBridge.";

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
  version: 3;
  fingerprint: string;
  updatedAt: string;
  chunks: Record<string, CachedChunk>;
};

type ScoreResponse = {
  candidates: KeywordElonCandidate[];
  warnings: string[];
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
    chunkSize: SCORE_CLIENT_CHUNK_SIZE,
    marketRecallVersion: 4,
    candidates: discovery.candidates,
  }));
  return { fingerprint, key: `${SCORE_CACHE_PREFIX}:${fingerprint}` };
}

function loadCache(key: string, fingerprint: string): ScoreCache {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) throw new Error("empty");
    const parsed = JSON.parse(raw) as ScoreCache;
    if (parsed.version !== 3 || parsed.fingerprint !== fingerprint || !parsed.chunks) throw new Error("stale");
    return parsed;
  } catch {
    return { version: 3, fingerprint, updatedAt: new Date().toISOString(), chunks: {} };
  }
}

type CacheSaveResult = {
  persisted: boolean;
  clearedCacheCount: number;
};

function scoreCacheStorageKeys() {
  const keys: string[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(SCORE_CACHE_FAMILY_PREFIX)) keys.push(key);
    }
  } catch {
    return [];
  }
  return keys;
}

function pruneScoreCacheStorage(keepKey = "") {
  let removed = 0;
  for (const storedKey of scoreCacheStorageKeys()) {
    if (storedKey === keepKey) continue;
    try {
      window.localStorage.removeItem(storedKey);
      removed += 1;
    } catch {
      // Storage access can be denied in restricted browser modes. The live run still continues in memory.
    }
  }
  return removed;
}

function isQuotaExceededError(error: unknown) {
  if (error instanceof DOMException) {
    return error.name === "QuotaExceededError"
      || error.name === "NS_ERROR_DOM_QUOTA_REACHED"
      || error.code === 22
      || error.code === 1014;
  }
  return error instanceof Error && /quota|storage.*full|exceeded/i.test(error.message);
}

function saveCache(key: string, cache: ScoreCache): CacheSaveResult {
  cache.updatedAt = new Date().toISOString();
  const serialized = JSON.stringify(cache);
  try {
    window.localStorage.setItem(key, serialized);
    return { persisted: true, clearedCacheCount: 0 };
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
  }

  const clearedCacheCount = pruneScoreCacheStorage();
  try {
    window.localStorage.setItem(key, serialized);
    return { persisted: true, clearedCacheCount };
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Keep the in-memory cache even when persistent storage is unavailable.
    }
    return { persisted: false, clearedCacheCount };
  }
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

function shouldAdaptiveSplit(status: number, detail: string, chunkLength: number) {
  if (chunkLength <= SCORE_MIN_ADAPTIVE_CHUNK_SIZE) return false;
  if (status === 504) return true;
  return /AI_SCORE_TIMEOUT|AI_SCORE_INCOMPLETE|AI_SCORE_ALL_CHUNKS_FAILED|FUNCTION_INVOCATION_TIMEOUT|operation was aborted|응답하지 않았습니다/i.test(detail);
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
      if (!body || !discovery || discovery.candidates.length <= SCORE_MIN_ADAPTIVE_CHUNK_SIZE) {
        return nativeFetch(input, init);
      }

      const scoreAdaptive = async (chunk: string[], label: string): Promise<ScoreResponse> => {
        const chunkDiscovery = filterDiscovery(discovery, chunk);
        const chunkBody = { ...body, discovery: chunkDiscovery };
        setProgress((previous) => ({
          ...previous,
          message: `AI 점수화 ${label} · ${chunk.length}개 처리 중`,
        }));

        let response: Response;
        try {
          response = await nativeFetch(input, {
            ...init,
            body: JSON.stringify(chunkBody),
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : "네트워크 요청 실패";
          if (shouldAdaptiveSplit(0, detail, chunk.length)) {
            const middle = Math.ceil(chunk.length / 2);
            const left = chunk.slice(0, middle);
            const right = chunk.slice(middle);
            setProgress((previous) => ({
              ...previous,
              message: `응답 지연 감지 · ${chunk.length}개를 ${left.length}+${right.length}개로 자동 축소`,
            }));
            const leftResult = await scoreAdaptive(left, `${label}-A`);
            const rightResult = await scoreAdaptive(right, `${label}-B`);
            return {
              candidates: [...leftResult.candidates, ...rightResult.candidates],
              warnings: [...leftResult.warnings, ...rightResult.warnings],
            };
          }
          throw new Error(`[score_keywords_chunk ${label}] ${detail}`);
        }

        const raw = await response.text();
        let payload: Record<string, unknown> | null = null;
        try {
          payload = raw ? JSON.parse(raw) as Record<string, unknown> : null;
        } catch {
          const detail = `HTTP ${response.status} · JSON이 아닌 응답: ${raw.slice(0, 220)}`;
          if (shouldAdaptiveSplit(response.status, detail, chunk.length)) {
            const middle = Math.ceil(chunk.length / 2);
            const left = chunk.slice(0, middle);
            const right = chunk.slice(middle);
            setProgress((previous) => ({
              ...previous,
              message: `서버 시간초과 감지 · ${chunk.length}개를 ${left.length}+${right.length}개로 자동 축소`,
            }));
            const leftResult = await scoreAdaptive(left, `${label}-A`);
            const rightResult = await scoreAdaptive(right, `${label}-B`);
            return {
              candidates: [...leftResult.candidates, ...rightResult.candidates],
              warnings: [...leftResult.warnings, ...rightResult.warnings],
            };
          }
          throw new Error(`[score_keywords_chunk ${label}] ${detail}`);
        }

        if (!response.ok || payload?.ok !== true || !Array.isArray(payload.candidates)) {
          const detail = typeof payload?.error === "string" ? payload.error : `HTTP ${response.status}`;
          if (shouldAdaptiveSplit(response.status, detail, chunk.length)) {
            const middle = Math.ceil(chunk.length / 2);
            const left = chunk.slice(0, middle);
            const right = chunk.slice(middle);
            setProgress((previous) => ({
              ...previous,
              message: `AI 지연 감지 · ${chunk.length}개를 ${left.length}+${right.length}개로 자동 축소`,
            }));
            const leftResult = await scoreAdaptive(left, `${label}-A`);
            const rightResult = await scoreAdaptive(right, `${label}-B`);
            return {
              candidates: [...leftResult.candidates, ...rightResult.candidates],
              warnings: [...leftResult.warnings, ...rightResult.warnings],
            };
          }
          throw new Error(`[score_keywords_chunk ${label}] ${detail}`);
        }

        return {
          candidates: payload.candidates as KeywordElonCandidate[],
          warnings: Array.isArray(payload.scoringWarnings)
            ? payload.scoringWarnings.filter((value): value is string => typeof value === "string")
            : [],
        };
      };

      const { fingerprint, key } = cacheKey(body, discovery);
      const staleCacheCount = pruneScoreCacheStorage(key);
      const cache = loadCache(key, fingerprint);
      let cachePersistenceAvailable = true;
      let cacheStorageWarning = staleCacheCount > 0
        ? `오래된 점수 캐시 ${staleCacheCount}개를 자동 정리했습니다.`
        : "";
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
        message: "AI 품질점수를 12개 단위로 나눠 실행합니다.",
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

        try {
          const result = await scoreAdaptive(chunk, `${index + 1}/${chunks.length}`);
          cache.chunks[String(index)] = {
            keys: chunkKeys,
            candidates: result.candidates,
            warnings: result.warnings,
          };
          if (cachePersistenceAvailable) {
          const saveResult = saveCache(key, cache);
          cachePersistenceAvailable = saveResult.persisted;
          if (saveResult.clearedCacheCount > 0) {
            cacheStorageWarning = `브라우저 저장공간 확보를 위해 이전 점수 캐시 ${saveResult.clearedCacheCount}개를 자동 정리했습니다.`;
          }
          if (!saveResult.persisted) {
            cacheStorageWarning = "브라우저 저장공간이 가득 차 캐시 저장 없이 현재 실행을 메모리에서 계속했습니다.";
          }
        }
        scoredCount = Object.values(cache.chunks).reduce((sum, row) => sum + row.candidates.length, 0);
          setProgress({
            active: true,
            done: index + 1,
            total: chunks.length,
            scored: scoredCount,
            message: cachePersistenceAvailable
            ? `AI 점수화 진행 · ${index + 1}/${chunks.length} · ${scoredCount}/${discovery.candidates.length}개 저장`
            : `AI 점수화 진행 · ${index + 1}/${chunks.length} · ${scoredCount}/${discovery.candidates.length}개 처리 · 브라우저 캐시 없이 계속`,
            error: "",
          });
          await sleep(200);
        } catch (error) {
          const message = error instanceof Error ? error.message : `점수화 ${index + 1}/${chunks.length} 실패`;
          setProgress((previous) => ({
            ...previous,
            active: false,
            error: message,
            message: "분할 점수화가 중단됐습니다. STEP 2를 다시 누르면 완료 지점부터 재개합니다.",
          }));
          return errorResponse(message, 500);
        }
      }

      const merged = chunks.flatMap((_, index) => cache.chunks[String(index)]?.candidates ?? []);
      merged.sort((a, b) => b.qualityScore - a.qualityScore || (b.totalSearch ?? -1) - (a.totalSearch ?? -1));
      const warnings = [...new Set(Object.values(cache.chunks).flatMap((chunk) => chunk.warnings))].slice(0, 10);

      let finalCandidates = merged;
      let enrichmentWarning = "";
      try {
        setProgress({
          active: true,
          done: chunks.length,
          total: chunks.length,
          scored: merged.length,
          message: "안전Gate 통과 후보의 월검색 미측정 값을 SearchAd로 보강합니다…",
          error: "",
        });
        const enrichResponse = await nativeFetch(input, {
          ...init,
          body: JSON.stringify({
            action: "enrich_demand",
            discovery,
            candidates: merged,
          }),
        });
        const raw = await enrichResponse.text();
        const payload = raw ? JSON.parse(raw) as Record<string, unknown> : null;
        if (enrichResponse.ok && payload?.ok === true && Array.isArray(payload.candidates)) {
          finalCandidates = payload.candidates as KeywordElonCandidate[];
          const requested = Array.isArray(payload.requestedKeywords) ? payload.requestedKeywords.length : 0;
          const matched = Array.isArray(payload.exactMatchedKeywords) ? payload.exactMatchedKeywords.length : 0;
          enrichmentWarning = `월검색 보강 ${requested}개 요청 · 정확 매칭 ${matched}개`;
        } else {
          enrichmentWarning = typeof payload?.error === "string" ? `월검색 보강 경고: ${payload.error}` : "월검색 보강 응답 없음";
        }
      } catch (error) {
        enrichmentWarning = `월검색 보강 경고: ${error instanceof Error ? error.message : String(error)}`;
      }

      finalCandidates.sort((a, b) => b.qualityScore - a.qualityScore || (b.totalSearch ?? -1) - (a.totalSearch ?? -1));
      const finalWarnings = [...warnings, enrichmentWarning, cacheStorageWarning].filter(Boolean).slice(0, 12);
      try {
        window.localStorage.removeItem(key);
      } catch {
        // A completed score action no longer needs its resume cache.
      }
      setProgress({
        active: false,
        done: chunks.length,
        total: chunks.length,
        scored: finalCandidates.length,
        message: `AI 점수화·월검색 보강 완료 · ${finalCandidates.length}/${discovery.candidates.length}개`,
        error: "",
      });
      window.setTimeout(() => {
        setProgress((previous) => previous.error ? previous : { ...previous, message: "" });
      }, 5000);

      return new Response(JSON.stringify({
        ok: true,
        action: "score_keywords",
        candidates: finalCandidates,
        scoringWarnings: finalWarnings,
        scoringChunkCount: chunks.length,
        scoringSuccessfulChunks: chunks.length,
        clientChunked: true,
        adaptiveSplit: true,
        demandEnriched: true,
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
    <div className={`fixed bottom-5 left-5 z-[9999] w-[380px] max-w-[calc(100vw-2.5rem)] rounded-2xl border p-4 shadow-xl ${progress.error ? "border-rose-300 bg-rose-50 text-rose-950" : "border-violet-200 bg-white text-slate-900"}`}>
      <div className="text-xs font-black uppercase tracking-[0.12em]">Keyword Lab · 적응형 분할 점수화</div>
      <div className="mt-2 text-sm font-bold">{progress.error || progress.message}</div>
      {progress.total > 0 ? (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs font-bold">
            <span>{progress.done}/{progress.total} 기본 묶음</span>
            <span>{progress.scored}개 저장</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-violet-600 transition-all" style={{ width: `${Math.min(100, (progress.done / progress.total) * 100)}%` }} />
          </div>
        </div>
      ) : null}
      <div className="mt-2 text-xs text-slate-600">12개 묶음이 느리면 6개 → 3개로 자동 축소하고, 마지막에 월검색 미측정 후보를 보강합니다.</div>
      {progress.error ? <div className="mt-2 text-xs">STEP 2를 다시 누르면 완료된 묶음은 건너뛰고 실패 지점부터 재개합니다.</div> : null}
    </div>
  );
}
