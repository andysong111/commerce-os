import { normalizeNaverItem, type NaverShoppingApiItem } from "@/lib/naverShoppingSnapshot";
import {
  compactKeywordElonKey,
  normalizeKeywordElonText,
  uniqueKeywordElonTexts,
  type KeywordElonIdentity,
  type KeywordElonSourceDraft,
} from "@/lib/keywordEngineElonLabV2";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const NAVER_SHOPPING_URL = "https://openapi.naver.com/v1/search/shop.json";
const DEFAULT_MODEL = "gpt-5-mini";
const BRIDGE_TIMEOUT_MS = 32_000;
const SHOPPING_TIMEOUT_MS = 10_000;
const SHOPPING_QUERY_LIMIT = 4;
const SHOPPING_DISPLAY = 40;
const MARKET_TERM_LIMIT = 80;

const STOPWORDS = new Set([
  "무료배송", "당일배송", "국내배송", "해외배송", "정품", "추천", "인기", "특가", "세일", "신상품",
  "사은품", "증정", "선물", "랜덤", "색상랜덤", "옵션", "선택", "단품", "세트", "묶음", "구성",
  "블랙", "화이트", "핑크", "그레이", "브라운", "베이지", "사이즈", "대형", "소형", "중형",
]);

type OpenAiPayload = {
  status?: unknown;
  incomplete_details?: { reason?: unknown };
  output_text?: unknown;
  output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }>;
  error?: { message?: unknown };
};

export type KeywordElonMarketRecall = {
  bridgeSeeds: string[];
  marketTerms: string[];
  searchSeeds: string[];
  shoppingTitleCount: number;
  shoppingConfigured: boolean;
  warnings: string[];
  model: string;
};

function openAiModel() {
  return (
    normalizeKeywordElonText(process.env.OPENAI_KEYWORD_ELON_MODEL) ||
    normalizeKeywordElonText(process.env.OPENAI_KEYWORD_IDENTITY_MODEL) ||
    normalizeKeywordElonText(process.env.OPENAI_MODEL) ||
    DEFAULT_MODEL
  );
}

function outputText(payload: OpenAiPayload) {
  const direct = normalizeKeywordElonText(payload.output_text);
  if (direct) return direct;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && normalizeKeywordElonText(content.text)) {
        return normalizeKeywordElonText(content.text);
      }
    }
  }
  return "";
}

function bridgeSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["bridgeSeeds"],
    properties: {
      bridgeSeeds: {
        type: "array",
        minItems: 6,
        maxItems: 18,
        items: { type: "string", minLength: 2, maxLength: 24 },
      },
    },
  };
}

async function generateBridgeSeeds(source: KeywordElonSourceDraft, identity: KeywordElonIdentity) {
  const apiKey = normalizeKeywordElonText(process.env.OPENAI_API_KEY);
  const model = openAiModel();
  if (!apiKey) {
    return {
      seeds: uniqueKeywordElonTexts([identity.coreProduct, ...identity.primarySeeds], 8),
      model,
      warning: "MARKET_BRIDGE_AI_NOT_CONFIGURED",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 1_800,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: [
                "당신은 한국 쇼핑시장의 실제 검색어를 찾기 위한 Market Bridge Seed 생성기다.",
                "1688 직역형 상품명을 반복하지 말고 한국 소비자가 시장에서 짧게 부르는 표현으로 건너가는 것이 목적이다.",
                "반드시 1~3어절의 짧은 표현 위주로 만든다.",
                "포함 대상: 대표 상품명, 통용 별칭/속칭, 구매자가 문제·욕구로 검색하는 표현, 기능·형태의 짧은 시장명.",
                "예: '코 보정 클립' 계열이면 코집게·코교정기·코높이기·콧대높이기·코뽕처럼 실제 시장에서 쓸 법한 짧은 다리 단어를 고려한다.",
                "브랜드·효능·재질·성별을 근거 없이 발명하지 않는다. 긴 설명문·옵션코드·색상·규격은 제외한다.",
                "후속 단계에서 네이버 쇼핑과 SearchAd가 실제 시장성을 검증하므로 recall을 넓게 하되 같은 뜻의 장문 조합은 피한다.",
              ].join("\n"),
            }],
          },
          {
            role: "user",
            content: [{
              type: "input_text",
              text: JSON.stringify({
                chineseTitle: source.chineseTitle,
                optionText: source.optionText,
                productIdentity: identity.koreanProductIdentity,
                coreProduct: identity.coreProduct,
                identityAnchor: identity.identityAnchor,
                primarySeeds: identity.primarySeeds,
                conditionalSeeds: identity.conditionalSeeds,
              }),
            }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "keyword_elon_market_bridge_v1",
            strict: true,
            schema: bridgeSchema(),
          },
        },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const raw = await response.text();
    let payload: OpenAiPayload = {};
    try {
      payload = JSON.parse(raw) as OpenAiPayload;
    } catch {
      return { seeds: [], model, warning: "MARKET_BRIDGE_INVALID_JSON" };
    }
    if (!response.ok) {
      return {
        seeds: [],
        model,
        warning: `MARKET_BRIDGE_HTTP_${response.status}: ${normalizeKeywordElonText(payload.error?.message) || "OpenAI 요청 실패"}`,
      };
    }
    if (normalizeKeywordElonText(payload.status) === "incomplete") {
      return {
        seeds: [],
        model,
        warning: `MARKET_BRIDGE_INCOMPLETE: ${normalizeKeywordElonText(payload.incomplete_details?.reason) || "unknown"}`,
      };
    }
    const text = outputText(payload);
    if (!text) return { seeds: [], model, warning: "MARKET_BRIDGE_EMPTY_OUTPUT" };
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { seeds: [], model, warning: "MARKET_BRIDGE_OUTPUT_PARSE_FAILED" };
    }
    const seeds = uniqueKeywordElonTexts(
      Array.isArray(parsed.bridgeSeeds) ? (parsed.bridgeSeeds as unknown[]) : [],
      18,
    ).filter((value) => compactKeywordElonKey(value).length >= 2);
    return { seeds, model, warning: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Market Bridge 실패";
    const warning = error instanceof Error && error.name === "AbortError"
      ? `MARKET_BRIDGE_TIMEOUT: ${BRIDGE_TIMEOUT_MS / 1000}초 내 응답 없음`
      : `MARKET_BRIDGE_FAILED: ${message}`;
    return { seeds: [], model, warning };
  } finally {
    clearTimeout(timeout);
  }
}

function naverShoppingCredentials() {
  const clientId = normalizeKeywordElonText(process.env.NAVER_SEARCH_CLIENT_ID);
  const clientSecret = normalizeKeywordElonText(process.env.NAVER_SEARCH_CLIENT_SECRET);
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

async function fetchShoppingTitles(query: string) {
  const credentials = naverShoppingCredentials();
  if (!credentials.configured) return { titles: [] as string[], warning: "NAVER_SHOPPING_NOT_CONFIGURED" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHOPPING_TIMEOUT_MS);
  try {
    const url = new URL(NAVER_SHOPPING_URL);
    url.searchParams.set("query", query);
    url.searchParams.set("display", String(SHOPPING_DISPLAY));
    url.searchParams.set("start", "1");
    url.searchParams.set("sort", "sim");
    const response = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": credentials.clientId,
        "X-Naver-Client-Secret": credentials.clientSecret,
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return { titles: [] as string[], warning: `NAVER_SHOPPING_HTTP_${response.status}` };
    const payload = await response.json() as { items?: NaverShoppingApiItem[] };
    const titles = (payload.items ?? [])
      .map((item) => normalizeNaverItem(item).title)
      .map(normalizeKeywordElonText)
      .filter(Boolean);
    return { titles, warning: "" };
  } catch (error) {
    const warning = error instanceof Error && error.name === "AbortError"
      ? "NAVER_SHOPPING_TIMEOUT"
      : `NAVER_SHOPPING_FAILED: ${error instanceof Error ? error.message : String(error)}`;
    return { titles: [] as string[], warning };
  } finally {
    clearTimeout(timeout);
  }
}

function marketTokens(title: string) {
  const cleaned = normalizeKeywordElonText(title)
    .replace(/[\[\](){}<>|/\\,.:;!?~^*_+=]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = cleaned
    .split(" ")
    .map((token) => token.replace(/^[^0-9A-Za-z가-힣]+|[^0-9A-Za-z가-힣]+$/g, ""))
    .filter((token) => {
      const key = compactKeywordElonKey(token);
      if (key.length < 2 || key.length > 18) return false;
      if (/^\d+$/.test(key)) return false;
      return !STOPWORDS.has(token);
    });
  const result = [...tokens];
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    const combined = `${tokens[index]}${tokens[index + 1]}`;
    const key = compactKeywordElonKey(combined);
    if (key.length >= 3 && key.length <= 20) result.push(combined);
  }
  return uniqueKeywordElonTexts(result, 100);
}

function extractMarketTerms(titles: string[]) {
  const count = new Map<string, { term: string; count: number }>();
  for (const title of titles) {
    for (const term of marketTokens(title)) {
      const key = compactKeywordElonKey(term);
      const current = count.get(key);
      count.set(key, { term: current?.term ?? term, count: (current?.count ?? 0) + 1 });
    }
  }
  return [...count.values()]
    .sort((a, b) => b.count - a.count || a.term.length - b.term.length || a.term.localeCompare(b.term))
    .slice(0, MARKET_TERM_LIMIT)
    .map((row) => row.term);
}

function chooseShoppingQueries(identity: KeywordElonIdentity, bridgeSeeds: string[]) {
  const values = uniqueKeywordElonTexts([
    ...bridgeSeeds,
    identity.coreProduct,
    ...identity.primarySeeds,
  ], 30)
    .filter((value) => compactKeywordElonKey(value).length >= 2 && compactKeywordElonKey(value).length <= 14)
    .sort((a, b) => compactKeywordElonKey(a).length - compactKeywordElonKey(b).length);
  return values.slice(0, SHOPPING_QUERY_LIMIT);
}

function chooseSearchSeeds(identity: KeywordElonIdentity, bridgeSeeds: string[], marketTerms: string[]) {
  const marketHead = marketTerms
    .filter((term) => compactKeywordElonKey(term).length >= 2 && compactKeywordElonKey(term).length <= 12)
    .slice(0, 12);
  return uniqueKeywordElonTexts([
    ...bridgeSeeds,
    ...marketHead,
    identity.coreProduct,
    ...identity.primarySeeds,
  ], 18).filter((value) => compactKeywordElonKey(value).length <= 16);
}

export async function buildKeywordElonMarketRecall(
  source: KeywordElonSourceDraft,
  identity: KeywordElonIdentity,
): Promise<KeywordElonMarketRecall> {
  const bridge = await generateBridgeSeeds(source, identity);
  const bridgeSeeds = uniqueKeywordElonTexts([
    ...bridge.seeds,
    identity.coreProduct,
  ], 18);
  const queries = chooseShoppingQueries(identity, bridgeSeeds);
  const shoppingResults = await Promise.all(queries.map(fetchShoppingTitles));
  const titles = uniqueKeywordElonTexts(shoppingResults.flatMap((result) => result.titles), 200);
  const marketTerms = extractMarketTerms(titles);
  const warnings = [
    bridge.warning,
    ...shoppingResults.map((result) => result.warning),
  ].filter(Boolean);
  const configured = naverShoppingCredentials().configured;
  return {
    bridgeSeeds,
    marketTerms,
    searchSeeds: chooseSearchSeeds(identity, bridgeSeeds, marketTerms),
    shoppingTitleCount: titles.length,
    shoppingConfigured: configured,
    warnings: [...new Set(warnings)].slice(0, 12),
    model: bridge.model,
  };
}
