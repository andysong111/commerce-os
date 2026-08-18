import {
  compactKeywordElonKey,
  normalizeKeywordElonText,
  uniqueKeywordElonTexts,
  type KeywordElonIdentity,
  type KeywordElonSourceDraft,
} from "@/lib/keywordEngineElonLabV2";
import { mineKeywordElonApiHubMarket } from "@/lib/keywordEngineElonLabV2ApiHub";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5-mini";
const BRIDGE_TIMEOUT_MS = 32_000;

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
  apiHubQueries: string[];
  apiHubDocumentCount: number;
  apiHubConfigured: boolean;
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
        minItems: 8,
        maxItems: 20,
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
      seeds: uniqueKeywordElonTexts([identity.coreProduct, ...identity.primarySeeds], 10),
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
        max_output_tokens: 1_900,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: [
                "당신은 한국 이커머스 시장어를 찾기 위한 Market Bridge Seed 생성기다.",
                "1688 직역형 설명을 반복하지 말고 한국 소비자가 실제 검색창에서 짧게 쓸 법한 시장 언어로 건너가는 것이 목적이다.",
                "1~3어절의 짧은 표현을 우선한다. 대표 상품명, 통용 별칭/속칭, 문제·욕구형 표현, 기능·형태의 짧은 시장명을 폭넓게 제안한다.",
                "긴 설명문, 색상·규격·옵션코드, 광고문구는 제외한다.",
                "브랜드·효능·재질·성별을 원본 근거 없이 발명하지 않는다.",
                "같은 어근의 장문 조합을 반복하지 말고 서로 다른 시장 언어 축을 8~16개 정도 확보한다.",
                "후속 단계에서 NAVER API HUB Search와 SearchAd가 실제 사용 흔적과 검색량을 검증하므로 recall을 우선한다.",
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
                functionModifiers: identity.functionModifiers,
                designShapeModifiers: identity.designShapeModifiers,
              }),
            }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "keyword_elon_market_bridge_v2",
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
      return { seeds: [] as string[], model, warning: "MARKET_BRIDGE_INVALID_JSON" };
    }
    if (!response.ok) {
      return {
        seeds: [] as string[],
        model,
        warning: `MARKET_BRIDGE_HTTP_${response.status}: ${normalizeKeywordElonText(payload.error?.message) || "OpenAI 요청 실패"}`,
      };
    }
    if (normalizeKeywordElonText(payload.status) === "incomplete") {
      return {
        seeds: [] as string[],
        model,
        warning: `MARKET_BRIDGE_INCOMPLETE: ${normalizeKeywordElonText(payload.incomplete_details?.reason) || "unknown"}`,
      };
    }
    const text = outputText(payload);
    if (!text) return { seeds: [] as string[], model, warning: "MARKET_BRIDGE_EMPTY_OUTPUT" };
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { seeds: [] as string[], model, warning: "MARKET_BRIDGE_OUTPUT_PARSE_FAILED" };
    }
    const seeds = uniqueKeywordElonTexts(
      Array.isArray(parsed.bridgeSeeds) ? (parsed.bridgeSeeds as unknown[]) : [],
      20,
    ).filter((value) => {
      const length = compactKeywordElonKey(value).length;
      return length >= 2 && length <= 16;
    });
    return { seeds, model, warning: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Market Bridge 실패";
    const warning = error instanceof Error && error.name === "AbortError"
      ? `MARKET_BRIDGE_TIMEOUT: ${BRIDGE_TIMEOUT_MS / 1000}초 내 응답 없음`
      : `MARKET_BRIDGE_FAILED: ${message}`;
    return { seeds: [] as string[], model, warning };
  } finally {
    clearTimeout(timeout);
  }
}

function chooseSearchSeeds(identity: KeywordElonIdentity, bridgeSeeds: string[], marketTerms: string[]) {
  const shortMarket = marketTerms.filter((term) => {
    const length = compactKeywordElonKey(term).length;
    return length >= 2 && length <= 12;
  }).slice(0, 24);
  return uniqueKeywordElonTexts([
    ...shortMarket,
    ...bridgeSeeds,
    identity.coreProduct,
    ...identity.primarySeeds,
  ], 30).filter((value) => compactKeywordElonKey(value).length <= 16);
}

export async function buildKeywordElonMarketRecall(
  source: KeywordElonSourceDraft,
  identity: KeywordElonIdentity,
): Promise<KeywordElonMarketRecall> {
  const bridge = await generateBridgeSeeds(source, identity);
  const bridgeSeeds = uniqueKeywordElonTexts([
    ...bridge.seeds,
    identity.coreProduct,
    ...identity.primarySeeds,
  ], 20);
  const apiHub = await mineKeywordElonApiHubMarket(identity, bridgeSeeds);
  const marketTerms = apiHub.terms.map((row) => row.term);
  const warnings = [bridge.warning, ...apiHub.warnings].filter(Boolean);
  return {
    bridgeSeeds,
    marketTerms,
    searchSeeds: chooseSearchSeeds(identity, bridgeSeeds, marketTerms),
    apiHubQueries: apiHub.queries,
    apiHubDocumentCount: apiHub.documents.length,
    apiHubConfigured: apiHub.configured,
    warnings: [...new Set(warnings)].slice(0, 16),
    model: bridge.model,
  };
}
