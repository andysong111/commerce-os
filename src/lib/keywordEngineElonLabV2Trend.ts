import {
  compactKeywordElonKey,
  normalizeKeywordElonText,
  uniqueKeywordElonCanonical,
  type KeywordElonCandidate,
  type KeywordElonTrendSignal,
} from "@/lib/keywordEngineElonLabV2";

const API_HUB_BASE = "https://naverapihub.apigw.ntruss.com";
const SEARCH_TREND_PATH = "/search-trend/v1/search";
const REQUEST_TIMEOUT_MS = 12_000;
const TREND_KEYWORD_LIMIT = 5;

type TrendPayload = {
  results?: Array<{
    title?: unknown;
    keywords?: unknown;
    data?: Array<{ period?: unknown; ratio?: unknown }>;
  }>;
};

function credentials() {
  const clientId = normalizeKeywordElonText(process.env.NAVER_API_HUB_CLIENT_ID);
  const clientSecret = normalizeKeywordElonText(process.env.NAVER_API_HUB_CLIENT_SECRET);
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  return { startDate: formatDate(start), endDate: formatDate(end) };
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp100(value: number) {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function trendSignal(keyword: string, ratios: number[]): KeywordElonTrendSignal {
  const recent = ratios.slice(-3);
  const prior = ratios.slice(0, Math.max(0, ratios.length - 3));
  const recentAverage = average(recent);
  const priorAverage = average(prior);
  const momentum = priorAverage > 0 ? recentAverage / priorAverage : recentAverage > 0 ? 2 : 1;
  const score = clamp100(50 + Math.max(-1, Math.min(1.25, momentum - 1)) * 32);
  return { keyword, recentAverage, priorAverage, momentum: Math.round(momentum * 100) / 100, score };
}

export async function enrichKeywordElonSearchTrend(candidates: KeywordElonCandidate[]) {
  const auth = credentials();
  const keywords = uniqueKeywordElonCanonical(
    candidates
      .filter((row) => row.safetyPass)
      .sort((a, b) => (b.totalSearch ?? -1) - (a.totalSearch ?? -1) || b.qualityScore - a.qualityScore)
      .map((row) => row.searchKeyword || row.searchKey || row.keyword),
    TREND_KEYWORD_LIMIT,
  );
  if (!auth.configured || !keywords.length) {
    return {
      configured: auth.configured,
      signals: [] as KeywordElonTrendSignal[],
      warnings: auth.configured ? [] : ["SEARCH_TREND_NOT_CONFIGURED"],
      requested: keywords,
    };
  }

  const { startDate, endDate } = dateRange();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_HUB_BASE}${SEARCH_TREND_PATH}`, {
      method: "POST",
      headers: {
        "X-NCP-APIGW-API-KEY-ID": auth.clientId,
        "X-NCP-APIGW-API-KEY": auth.clientSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate,
        endDate,
        timeUnit: "month",
        keywordGroups: keywords.map((keyword) => ({ groupName: keyword, keywords: [keyword] })),
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const raw = await response.text();
    if (!response.ok) {
      const permission = response.status === 401 && /활성화|Application|API/i.test(raw)
        ? "SEARCH_TREND_PERMISSION_REQUIRED: NAVER API HUB Application에서 검색어 트렌드를 활성화해 주세요."
        : `SEARCH_TREND_HTTP_${response.status}:${raw.replace(/\s+/g, " ").slice(0, 180)}`;
      return { configured: true, signals: [] as KeywordElonTrendSignal[], warnings: [permission], requested: keywords };
    }
    let payload: TrendPayload = {};
    try { payload = JSON.parse(raw) as TrendPayload; } catch { return { configured: true, signals: [] as KeywordElonTrendSignal[], warnings: ["SEARCH_TREND_INVALID_JSON"], requested: keywords }; }
    const signals = (payload.results ?? []).map((result) => {
      const keyword = compactKeywordElonKey(result.title) || compactKeywordElonKey(Array.isArray(result.keywords) ? result.keywords[0] : "");
      const ratios = (result.data ?? []).map((item) => Number(item.ratio)).filter(Number.isFinite);
      return keyword && ratios.length ? trendSignal(keyword, ratios) : null;
    }).filter((value): value is KeywordElonTrendSignal => Boolean(value));
    return { configured: true, signals, warnings: [] as string[], requested: keywords };
  } catch (error) {
    const warning = error instanceof Error && error.name === "AbortError"
      ? "SEARCH_TREND_TIMEOUT"
      : `SEARCH_TREND_FAILED:${error instanceof Error ? error.message : String(error)}`;
    return { configured: true, signals: [] as KeywordElonTrendSignal[], warnings: [warning], requested: keywords };
  } finally {
    clearTimeout(timeout);
  }
}
