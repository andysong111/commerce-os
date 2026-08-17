import crypto from "node:crypto";
import {
  compactKeywordElonKey,
  normalizeKeywordElonText,
  type KeywordElonSearchAdStat,
} from "@/lib/keywordEngineElonLabV2";

const BASE_URL = "https://api.searchad.naver.com";
const KEYWORDSTOOL_URI = "/keywordstool";
const REQUEST_TIMEOUT_MS = 12_000;
const REQUEST_INTERVAL_MS = 1_200;
const RATE_LIMIT_BACKOFF_MS = 6_500;

function env() {
  const apiKey = normalizeKeywordElonText(process.env.NAVER_SEARCHAD_API_KEY);
  const secretKey = normalizeKeywordElonText(process.env.NAVER_SEARCHAD_SECRET_KEY);
  const customerId = normalizeKeywordElonText(process.env.NAVER_SEARCHAD_CUSTOMER_ID);
  return { apiKey, secretKey, customerId, configured: Boolean(apiKey && secretKey && customerId) };
}

function signature(timestamp: string, method: string, uri: string, secretKey: string) {
  return crypto
    .createHmac("sha256", secretKey)
    .update(`${timestamp}.${method}.${uri}`)
    .digest("base64");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).replace(/,/g, "").replace(/^<\s*/, "").trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function totalCount(pc: number | null, mobile: number | null) {
  return pc === null && mobile === null ? null : (pc ?? 0) + (mobile ?? 0);
}

function safeErrorBody(raw: string, status: number) {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const safe = {
      status,
      type: normalizeKeywordElonText(parsed.type),
      title: normalizeKeywordElonText(parsed.title),
      detail: normalizeKeywordElonText(parsed.detail),
    };
    return JSON.stringify(safe);
  } catch {
    return raw.replace(/"?apikey"?\s*:\s*"[^"]+"/gi, '"apikey":"[REDACTED]"').replace(/\s+/g, " ").slice(0, 180);
  }
}

function parseRow(item: Record<string, unknown>, sourceSeed: string): KeywordElonSearchAdStat | null {
  const relKeyword = normalizeKeywordElonText(item.relKeyword);
  if (!relKeyword) return null;
  const pcSearch = numberOrNull(item.monthlyPcQcCnt);
  const mobileSearch = numberOrNull(item.monthlyMobileQcCnt);
  return {
    keyword: relKeyword,
    relKeyword,
    totalSearch: totalCount(pcSearch, mobileSearch),
    pcSearch,
    mobileSearch,
    compIdx:
      typeof item.compIdx === "number"
        ? item.compIdx
        : normalizeKeywordElonText(item.compIdx) || null,
    plAvgDepth: numberOrNull(item.plAvgDepth),
    monthlyAvePcClicks: numberOrNull(item.monthlyAvePcClkCnt),
    monthlyAveMobileClicks: numberOrNull(item.monthlyAveMobileClkCnt),
    monthlyAvePcCtr: numberOrNull(item.monthlyAvePcCtr),
    monthlyAveMobileCtr: numberOrNull(item.monthlyAveMobileCtr),
    sourceSeeds: [sourceSeed],
  };
}

type FetchSeedResult = {
  ok: boolean;
  rows: KeywordElonSearchAdStat[];
  warning: string;
  rateLimited: boolean;
};

async function fetchSeedOnce(seed: string): Promise<FetchSeedResult> {
  const credentials = env();
  if (!credentials.configured) {
    return {
      ok: false,
      rows: [],
      warning: "SEARCHAD_NOT_CONFIGURED",
      rateLimited: false,
    };
  }
  const timestamp = String(Date.now());
  const headers = {
    "X-Timestamp": timestamp,
    "X-API-KEY": credentials.apiKey,
    "X-Customer": credentials.customerId,
    "X-Signature": signature(timestamp, "GET", KEYWORDSTOOL_URI, credentials.secretKey),
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const hint = compactKeywordElonKey(seed);
    const response = await fetch(
      `${BASE_URL}${KEYWORDSTOOL_URI}?hintKeywords=${encodeURIComponent(hint)}&showDetail=1`,
      { headers, signal: controller.signal, cache: "no-store" },
    );
    const raw = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        rows: [],
        warning: `SEARCHAD_HTTP_${response.status}:${safeErrorBody(raw, response.status)}`,
        rateLimited: response.status === 429,
      };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        rows: [],
        warning: "SEARCHAD_INVALID_JSON",
        rateLimited: false,
      };
    }
    const keywordList =
      payload && typeof payload === "object" && Array.isArray((payload as { keywordList?: unknown[] }).keywordList)
        ? (payload as { keywordList: unknown[] }).keywordList
        : [];
    const rows = keywordList
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => parseRow(item, seed))
      .filter((item): item is KeywordElonSearchAdStat => Boolean(item));
    return { ok: true, rows, warning: "", rateLimited: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "SEARCHAD_REQUEST_FAILED";
    return { ok: false, rows: [], warning: message, rateLimited: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSeedWithRateLimitRecovery(seed: string): Promise<FetchSeedResult> {
  const first = await fetchSeedOnce(seed);
  if (!first.rateLimited) return first;

  await sleep(RATE_LIMIT_BACKOFF_MS);
  const retry = await fetchSeedOnce(seed);
  if (!retry.rateLimited) return retry;

  return {
    ...retry,
    warning:
      "SEARCHAD_RATE_LIMIT_COOLDOWN_REQUIRED: 키워드도구 429가 반복되었습니다. 일부 성공 결과만 사용하고 SearchAd 추가 호출을 중단했습니다. 최소 5분 뒤 다시 실행해 주세요.",
  };
}

function mergeStat(
  map: Map<string, KeywordElonSearchAdStat>,
  row: KeywordElonSearchAdStat,
) {
  const key = compactKeywordElonKey(row.keyword);
  if (!key) return;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, row);
    return;
  }
  const sourceSeeds = [...new Set([...existing.sourceSeeds, ...row.sourceSeeds])];
  const existingDemand = existing.totalSearch ?? -1;
  const newDemand = row.totalSearch ?? -1;
  map.set(key, { ...(newDemand > existingDemand ? row : existing), sourceSeeds });
}

export async function discoverKeywordElonSearchAd(seeds: string[]) {
  const credentials = env();
  if (!credentials.configured) {
    return {
      configured: false,
      rows: [] as KeywordElonSearchAdStat[],
      warnings: ["NAVER SearchAd 자격증명이 없어 검색량·경쟁 데이터는 이번 실행에서 제외됩니다."],
    };
  }

  const normalizedSeeds = [...new Set(seeds.map(normalizeKeywordElonText).filter(Boolean))].slice(0, 8);
  const map = new Map<string, KeywordElonSearchAdStat>();
  const warnings: string[] = [];

  for (let index = 0; index < normalizedSeeds.length; index += 1) {
    if (index > 0) await sleep(REQUEST_INTERVAL_MS);
    const result = await fetchSeedWithRateLimitRecovery(normalizedSeeds[index]);
    if (!result.ok && result.warning) warnings.push(result.warning);
    for (const row of result.rows) mergeStat(map, row);
    if (result.warning.startsWith("SEARCHAD_RATE_LIMIT_COOLDOWN_REQUIRED")) break;
  }

  return {
    configured: true,
    rows: [...map.values()].sort((a, b) => (b.totalSearch ?? -1) - (a.totalSearch ?? -1)),
    warnings: [...new Set(warnings)].slice(0, 12),
  };
}
