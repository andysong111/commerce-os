import {
  compactKeywordElonKey,
  normalizeKeywordElonText,
  uniqueKeywordElonTexts,
  type KeywordElonIdentity,
} from "@/lib/keywordEngineElonLabV2";

const API_HUB_BASE = "https://naverapihub.apigw.ntruss.com";
const SEARCH_DISPLAY = 30;
const SEARCH_QUERY_LIMIT = 5;
const REQUEST_TIMEOUT_MS = 10_000;
const MARKET_TERM_LIMIT = 120;

const SEARCH_ENDPOINTS = [
  { name: "blog", path: "/search/v1/blog" },
  { name: "cafe", path: "/search/v1/cafearticle" },
  { name: "web", path: "/search/v1/webkr" },
] as const;

const STOPWORDS = new Set([
  "네이버", "블로그", "카페", "후기", "리뷰", "추천", "정보", "방법", "사용", "사용법", "제품", "상품",
  "구매", "판매", "가격", "무료배송", "배송", "정품", "할인", "특가", "세일", "신상품", "인기", "최저가",
  "오늘", "이번", "관련", "대한", "위한", "있는", "없는", "좋은", "좋아요", "합니다", "입니다", "그리고", "하지만",
  "색상", "블랙", "화이트", "핑크", "그레이", "브라운", "베이지", "사이즈", "대형", "소형", "중형", "세트", "단품",
]);

type ApiHubItem = { title?: unknown; description?: unknown };
type ApiHubPayload = { items?: ApiHubItem[] };

type MarketDocument = {
  source: string;
  title: string;
  description: string;
};

export type KeywordElonApiHubMarketTerm = {
  term: string;
  score: number;
  documentCount: number;
  titleCount: number;
  sourceCount: number;
  sources: string[];
};

export type KeywordElonApiHubMarketMine = {
  configured: boolean;
  queries: string[];
  documents: MarketDocument[];
  terms: KeywordElonApiHubMarketTerm[];
  warnings: string[];
};

function credentials() {
  const clientId = normalizeKeywordElonText(process.env.NAVER_API_HUB_CLIENT_ID);
  const clientSecret = normalizeKeywordElonText(process.env.NAVER_API_HUB_CLIENT_SECRET);
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

function stripHtml(value: unknown) {
  return normalizeKeywordElonText(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanToken(value: string) {
  return value.replace(/^[^0-9A-Za-z가-힣]+|[^0-9A-Za-z가-힣]+$/g, "");
}

function tokensFromText(value: string) {
  return stripHtml(value)
    .replace(/[\[\](){}<>|/\\,.:;!?~^*_+=·•▶▷→←]+/g, " ")
    .split(/\s+/)
    .map(cleanToken)
    .filter((token) => {
      const key = compactKeywordElonKey(token);
      if (key.length < 2 || key.length > 16) return false;
      if (/^\d+$/.test(key)) return false;
      return !STOPWORDS.has(token);
    });
}

function termsFromText(value: string) {
  const tokens = tokensFromText(value);
  const terms = [...tokens];
  for (let size = 2; size <= 3; size += 1) {
    for (let index = 0; index + size <= tokens.length; index += 1) {
      const joined = tokens.slice(index, index + size).join("");
      const key = compactKeywordElonKey(joined);
      if (key.length >= 3 && key.length <= 18) terms.push(joined);
    }
  }
  return uniqueKeywordElonTexts(terms, 240);
}

function chooseQueries(identity: KeywordElonIdentity, bridgeSeeds: string[]) {
  const values = uniqueKeywordElonTexts([
    ...bridgeSeeds,
    identity.coreProduct,
    ...identity.primarySeeds,
    ...identity.conditionalSeeds,
  ], 40)
    .filter((value) => {
      const length = compactKeywordElonKey(value).length;
      return length >= 2 && length <= 12;
    })
    .sort((a, b) => compactKeywordElonKey(a).length - compactKeywordElonKey(b).length);
  return values.slice(0, SEARCH_QUERY_LIMIT);
}

async function fetchSearch(source: (typeof SEARCH_ENDPOINTS)[number], query: string) {
  const auth = credentials();
  if (!auth.configured) return { documents: [] as MarketDocument[], warning: "API_HUB_NOT_CONFIGURED" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = new URL(`${API_HUB_BASE}${source.path}`);
    url.searchParams.set("query", query);
    url.searchParams.set("display", String(SEARCH_DISPLAY));
    url.searchParams.set("start", "1");
    url.searchParams.set("sort", "sim");
    url.searchParams.set("format", "json");
    const response = await fetch(url, {
      headers: {
        "X-NCP-APIGW-API-KEY-ID": auth.clientId,
        "X-NCP-APIGW-API-KEY": auth.clientSecret,
      },
      signal: controller.signal,
      cache: "no-store",
    });
    const raw = await response.text();
    if (!response.ok) {
      return {
        documents: [] as MarketDocument[],
        warning: `API_HUB_${source.name.toUpperCase()}_HTTP_${response.status}:${raw.replace(/\s+/g, " ").slice(0, 140)}`,
      };
    }
    let payload: ApiHubPayload = {};
    try {
      payload = JSON.parse(raw) as ApiHubPayload;
    } catch {
      return { documents: [] as MarketDocument[], warning: `API_HUB_${source.name.toUpperCase()}_INVALID_JSON` };
    }
    const documents = (payload.items ?? []).map((item) => ({
      source: source.name,
      title: stripHtml(item.title),
      description: stripHtml(item.description),
    })).filter((item) => item.title || item.description);
    return { documents, warning: "" };
  } catch (error) {
    const warning = error instanceof Error && error.name === "AbortError"
      ? `API_HUB_${source.name.toUpperCase()}_TIMEOUT`
      : `API_HUB_${source.name.toUpperCase()}_FAILED:${error instanceof Error ? error.message : String(error)}`;
    return { documents: [] as MarketDocument[], warning };
  } finally {
    clearTimeout(timeout);
  }
}

function rankTerms(documents: MarketDocument[], queries: string[]) {
  const queryKeys = new Set(queries.map(compactKeywordElonKey));
  const stats = new Map<string, {
    term: string;
    documents: Set<number>;
    titleDocuments: Set<number>;
    sources: Set<string>;
  }>();

  documents.forEach((doc, index) => {
    const titleTerms = termsFromText(doc.title);
    const descriptionTerms = termsFromText(doc.description);
    const all = uniqueKeywordElonTexts([...titleTerms, ...descriptionTerms], 300);
    for (const term of all) {
      const key = compactKeywordElonKey(term);
      if (!key || queryKeys.has(key)) continue;
      const row = stats.get(key) ?? {
        term,
        documents: new Set<number>(),
        titleDocuments: new Set<number>(),
        sources: new Set<string>(),
      };
      row.documents.add(index);
      if (titleTerms.some((value) => compactKeywordElonKey(value) === key)) row.titleDocuments.add(index);
      row.sources.add(doc.source);
      stats.set(key, row);
    }
  });

  return [...stats.values()]
    .map((row) => {
      const documentCount = row.documents.size;
      const titleCount = row.titleDocuments.size;
      const sourceCount = row.sources.size;
      const length = compactKeywordElonKey(row.term).length;
      const shortBonus = length <= 6 ? 4 : length <= 10 ? 2 : 0;
      const score = documentCount * 2 + titleCount * 3 + sourceCount * 5 + shortBonus;
      return {
        term: row.term,
        score,
        documentCount,
        titleCount,
        sourceCount,
        sources: [...row.sources].sort(),
      } satisfies KeywordElonApiHubMarketTerm;
    })
    .filter((row) => row.documentCount >= 2 || row.sourceCount >= 2 || row.titleCount >= 2)
    .sort((a, b) => b.score - a.score || b.sourceCount - a.sourceCount || b.documentCount - a.documentCount || a.term.length - b.term.length)
    .slice(0, MARKET_TERM_LIMIT);
}

export async function mineKeywordElonApiHubMarket(identity: KeywordElonIdentity, bridgeSeeds: string[]): Promise<KeywordElonApiHubMarketMine> {
  const auth = credentials();
  const queries = chooseQueries(identity, bridgeSeeds);
  if (!auth.configured) {
    return {
      configured: false,
      queries,
      documents: [],
      terms: [],
      warnings: ["NAVER API HUB 광산 미연결 · NAVER_API_HUB_CLIENT_ID / NAVER_API_HUB_CLIENT_SECRET 필요"],
    };
  }

  const results = [] as Array<{ documents: MarketDocument[]; warning: string }>;
  for (const query of queries) {
    const queryResults = await Promise.all(SEARCH_ENDPOINTS.map((source) => fetchSearch(source, query)));
    results.push(...queryResults);
  }
  const documents = results.flatMap((result) => result.documents);
  const warnings = [...new Set(results.map((result) => result.warning).filter(Boolean))].slice(0, 12);
  return {
    configured: true,
    queries,
    documents,
    terms: rankTerms(documents, queries),
    warnings,
  };
}

export function keywordElonApiHubConfigured() {
  return credentials().configured;
}
