import {
  compactKeywordElonKey,
  normalizeKeywordElonText,
  uniqueKeywordElonCanonical,
  type KeywordElonIdentity,
  type KeywordElonMarketEvidence,
  type KeywordElonSourceDraft,
} from "@/lib/keywordEngineElonLabV2";
import { mineKeywordElonApiHubMarket } from "@/lib/keywordEngineElonLabV2ApiHub";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5-mini";
const BRIDGE_TIMEOUT_MS = 28_000;

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
  evidenceTerms: KeywordElonMarketEvidence[];
  searchSeeds: string[];
  apiHubQueries: string[];
  apiHubDocumentCount: number;
  apiHubActiveSources: string[];
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
      if (content.type === "output_text" && normalizeKeywordElonText(content.text)) return normalizeKeywordElonText(content.text);
    }
  }
  return "";
}

function bridgeSchema() {
  const list = { type: "array", minItems: 0, maxItems: 5, items: { type: "string", minLength: 2, maxLength: 24 } };
  return {
    type: "object",
    additionalProperties: false,
    required: ["productNames", "aliases", "needTerms"],
    properties: {
      productNames: list,
      aliases: list,
      needTerms: list,
    },
  };
}

async function generateBridgeSeeds(source: KeywordElonSourceDraft, identity: KeywordElonIdentity) {
  const apiKey = normalizeKeywordElonText(process.env.KEYWORD_ENGINE_OPENAI_API_KEY);
  const model = openAiModel();
  if (!apiKey) {
    return {
      seeds: uniqueKeywordElonCanonical([identity.coreProduct, ...identity.primarySeeds], 10),
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
        max_output_tokens: 1_200,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: [
                "당신은 한국 이커머스 Market Bridge 생성기다.",
                "시장 키워드를 대량 발명하는 역할이 아니라 실제 시장 데이터 광산에 넣을 첫 삽만 만든다.",
                "대표 상품명 최대 5개, 한국에서 통용될 수 있는 별칭/속칭 최대 5개, 소비자의 문제·욕구 표현 최대 5개만 반환한다.",
                "각 표현은 1~3어절의 짧은 검색어여야 하며 제조사식 긴 설명문을 금지한다.",
                "색상·규격·옵션코드·광고문구·브랜드·근거 없는 효능은 제외한다.",
                "중국 원본과 상품 정체성에서 벗어난 다른 상품을 만들지 않는다.",
                "후속 지식iN·카페·블로그 Evidence Miner가 실제 사용 증거를 검증하므로 다양성은 확보하되 최대 15개를 넘지 않는다.",
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
            name: "keyword_elon_market_bridge_v6",
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
    try { payload = JSON.parse(raw) as OpenAiPayload; } catch { return { seeds: [] as string[], model, warning: "MARKET_BRIDGE_INVALID_JSON" }; }
    if (!response.ok) return { seeds: [] as string[], model, warning: `MARKET_BRIDGE_HTTP_${response.status}: ${normalizeKeywordElonText(payload.error?.message) || "OpenAI 요청 실패"}` };
    if (normalizeKeywordElonText(payload.status) === "incomplete") return { seeds: uniqueKeywordElonCanonical([identity.coreProduct, ...identity.primarySeeds], 10), model, warning: `MARKET_BRIDGE_INCOMPLETE: ${normalizeKeywordElonText(payload.incomplete_details?.reason) || "unknown"} · 기존 Seed로 계속 진행` };
    const text = outputText(payload);
    if (!text) return { seeds: uniqueKeywordElonCanonical([identity.coreProduct, ...identity.primarySeeds], 10), model, warning: "MARKET_BRIDGE_EMPTY_OUTPUT" };
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { return { seeds: uniqueKeywordElonCanonical([identity.coreProduct, ...identity.primarySeeds], 10), model, warning: "MARKET_BRIDGE_OUTPUT_PARSE_FAILED" }; }
    const arrays = [parsed.productNames, parsed.aliases, parsed.needTerms].flatMap((value) => Array.isArray(value) ? value : []);
    const seeds = uniqueKeywordElonCanonical(arrays, 15).filter((value) => value.length >= 2 && value.length <= 16);
    return { seeds, model, warning: "" };
  } catch (error) {
    const warning = error instanceof Error && error.name === "AbortError"
      ? `MARKET_BRIDGE_TIMEOUT: ${BRIDGE_TIMEOUT_MS / 1000}초 내 응답 없음 · 기존 Seed로 계속 진행`
      : `MARKET_BRIDGE_FAILED: ${error instanceof Error ? error.message : String(error)}`;
    return { seeds: uniqueKeywordElonCanonical([identity.coreProduct, ...identity.primarySeeds], 10), model, warning };
  } finally {
    clearTimeout(timeout);
  }
}

function chooseSearchSeeds(identity: KeywordElonIdentity, bridgeSeeds: string[], evidenceTerms: KeywordElonMarketEvidence[]) {
  const evidence = [...evidenceTerms]
    .sort((a, b) => b.score - a.score || a.term.length - b.term.length)
    .map((row) => row.term)
    .filter((term) => term.length >= 2 && term.length <= 12);
  return uniqueKeywordElonCanonical([
    ...evidence,
    ...bridgeSeeds,
    identity.coreProduct,
    ...identity.primarySeeds,
  ], 30).filter((value) => value.length <= 16);
}

export async function buildKeywordElonMarketRecall(
  source: KeywordElonSourceDraft,
  identity: KeywordElonIdentity,
): Promise<KeywordElonMarketRecall> {
  const bridge = await generateBridgeSeeds(source, identity);
  const bridgeSeeds = uniqueKeywordElonCanonical([
    ...bridge.seeds,
    identity.coreProduct,
    ...identity.primarySeeds,
  ], 18);
  const apiHub = await mineKeywordElonApiHubMarket(identity, bridgeSeeds);
  const evidenceTerms = apiHub.terms;
  const marketTerms = evidenceTerms.map((row) => row.term);
  const warnings = [bridge.warning, ...apiHub.warnings].filter(Boolean);
  return {
    bridgeSeeds,
    marketTerms,
    evidenceTerms,
    searchSeeds: chooseSearchSeeds(identity, bridgeSeeds, evidenceTerms),
    apiHubQueries: apiHub.queries,
    apiHubDocumentCount: apiHub.documents.length,
    apiHubActiveSources: apiHub.activeSources,
    apiHubConfigured: apiHub.configured,
    warnings: [...new Set(warnings)].slice(0, 24),
    model: bridge.model,
  };
}
