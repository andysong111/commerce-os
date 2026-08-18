import {
  compactKeywordElonKey,
  normalizeKeywordElonText,
  uniqueKeywordElonTexts,
  type KeywordElonDiscovery,
  type KeywordElonIdentity,
  type KeywordElonSourceDraft,
} from "@/lib/keywordEngineElonLabV2";
import { buildKeywordElonMarketRecall, type KeywordElonMarketRecall } from "@/lib/keywordEngineElonLabV2MarketRecall";
import { discoverKeywordElonSearchAd } from "@/lib/keywordEngineElonLabV2SearchAd";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const AI_DISCOVERY_TIMEOUT_MS = 70_000;
const DEFAULT_MODEL = "gpt-5-mini";

type OpenAiPayload = {
  status?: unknown;
  incomplete_details?: { reason?: unknown };
  output_text?: unknown;
  output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }>;
  error?: { message?: unknown };
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

function generationSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["keywords"],
    properties: {
      keywords: {
        type: "array",
        minItems: 8,
        maxItems: 70,
        items: { type: "string", minLength: 1, maxLength: 60 },
      },
    },
  };
}

async function discoverAiCandidates(
  source: KeywordElonSourceDraft,
  identity: KeywordElonIdentity,
  market: KeywordElonMarketRecall,
) {
  const apiKey = normalizeKeywordElonText(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    return { keywords: [] as string[], model: openAiModel(), warning: "AI_DISCOVERY_NOT_CONFIGURED" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_DISCOVERY_TIMEOUT_MS);
  const model = openAiModel();
  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 3_500,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: [
                  "당신은 한국 쇼핑 검색어 후보 발굴기다.",
                  "최종 키워드를 고르는 단계가 아니라 후보 recall을 넓히는 단계다.",
                  "중국어 직역형 장문보다 한국 소비자가 실제 시장에서 쓰는 짧은 상품명·속칭·욕구형 표현을 우선한다.",
                  "입력에 Market Bridge Seed와 네이버 쇼핑 제목에서 관찰된 시장어가 있으면 반드시 적극 활용한다.",
                  "상품과 다른 물건, 브랜드 발명, 근거 없는 성별·효능·재질·규격은 금지한다.",
                  "같은 의미의 긴 조합만 반복하지 말고 대표어·별칭·문제/욕구어·형태어를 폭넓게 섞는다.",
                  "한국 소비자가 실제 검색창에 입력할 법한 1~3어절의 짧은 명사구를 우선한다.",
                  "중복을 피하고 35~60개 정도를 제안한다. 품질 평가는 다음 단계가 한다.",
                ].join("\n"),
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(
                  {
                    chineseTitle: source.chineseTitle,
                    optionText: source.optionText,
                    productIdentity: identity.koreanProductIdentity,
                    coreProduct: identity.coreProduct,
                    identityAnchor: identity.identityAnchor,
                    primarySeeds: identity.primarySeeds,
                    conditionalSeeds: identity.conditionalSeeds,
                    marketBridgeSeeds: market.bridgeSeeds,
                    observedNaverShoppingTerms: market.marketTerms.slice(0, 50),
                  },
                  null,
                  2,
                ),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "keyword_elon_candidate_pool_v4_market_recall",
            strict: true,
            schema: generationSchema(),
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
      return { keywords: [] as string[], model, warning: "AI_DISCOVERY_INVALID_JSON" };
    }
    if (!response.ok) {
      return {
        keywords: [] as string[],
        model,
        warning: `AI_DISCOVERY_HTTP_${response.status}: ${normalizeKeywordElonText(payload.error?.message) || "OpenAI 요청 실패"}`,
      };
    }
    const status = normalizeKeywordElonText(payload.status);
    if (status === "incomplete") {
      const reason = normalizeKeywordElonText(payload.incomplete_details?.reason);
      return { keywords: [] as string[], model, warning: `AI_DISCOVERY_INCOMPLETE: ${reason || "unknown"}` };
    }
    const text = outputText(payload);
    if (!text) return { keywords: [] as string[], model, warning: "AI_DISCOVERY_EMPTY_OUTPUT" };
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { keywords: [] as string[], model, warning: "AI_DISCOVERY_OUTPUT_PARSE_FAILED" };
    }
    const keywords = uniqueKeywordElonTexts(
      Array.isArray(parsed.keywords) ? (parsed.keywords as unknown[]) : [],
      90,
    );
    return { keywords, model, warning: "" };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : "AI 후보확장 실패";
    return {
      keywords: [] as string[],
      model,
      warning:
        name === "AbortError"
          ? `AI_DISCOVERY_TIMEOUT: ${AI_DISCOVERY_TIMEOUT_MS / 1000}초 내 응답 없음 · 시장/ SearchAd 후보로 계속 진행`
          : `AI_DISCOVERY_FAILED: ${message}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackMarket(identity: KeywordElonIdentity, warning: string): KeywordElonMarketRecall {
  const bridgeSeeds = uniqueKeywordElonTexts([identity.coreProduct, ...identity.primarySeeds], 10);
  return {
    bridgeSeeds,
    marketTerms: [],
    searchSeeds: bridgeSeeds,
    shoppingTitleCount: 0,
    shoppingConfigured: false,
    warnings: [warning],
    model: openAiModel(),
  };
}

function shortAiSearchSeeds(keywords: string[]) {
  return keywords
    .filter((keyword) => {
      const length = compactKeywordElonKey(keyword).length;
      return length >= 2 && length <= 12;
    })
    .sort((a, b) => compactKeywordElonKey(a).length - compactKeywordElonKey(b).length)
    .slice(0, 8);
}

export async function discoverKeywordElonCandidatesResilient(
  source: KeywordElonSourceDraft,
  identity: KeywordElonIdentity,
): Promise<KeywordElonDiscovery> {
  const seeds = uniqueKeywordElonTexts(
    [...identity.primarySeeds, ...identity.conditionalSeeds],
    8,
  );
  if (!seeds.length) throw new Error("DISCOVERY_NO_SEED: STEP 1 Seed가 없습니다.");

  const marketSettled = await Promise.allSettled([buildKeywordElonMarketRecall(source, identity)]);
  const market = marketSettled[0].status === "fulfilled"
    ? marketSettled[0].value
    : fallbackMarket(
        identity,
        `MARKET_RECALL_FAILED: ${marketSettled[0].reason instanceof Error ? marketSettled[0].reason.message : String(marketSettled[0].reason)}`,
      );

  const aiSettled = await Promise.allSettled([discoverAiCandidates(source, identity, market)]);
  const ai = aiSettled[0].status === "fulfilled"
    ? aiSettled[0].value
    : {
        keywords: [] as string[],
        model: openAiModel(),
        warning: `AI_DISCOVERY_FAILED: ${aiSettled[0].reason instanceof Error ? aiSettled[0].reason.message : String(aiSettled[0].reason)}`,
      };

  const searchAdSeeds = uniqueKeywordElonTexts([
    ...market.searchSeeds,
    ...shortAiSearchSeeds(ai.keywords),
    ...market.bridgeSeeds,
    ...seeds,
  ], 20);

  const searchAdSettled = await Promise.allSettled([discoverKeywordElonSearchAd(searchAdSeeds)]);
  const searchAd = searchAdSettled[0].status === "fulfilled"
    ? searchAdSettled[0].value
    : {
        configured: Boolean(
          process.env.NAVER_SEARCHAD_API_KEY?.trim() &&
            process.env.NAVER_SEARCHAD_SECRET_KEY?.trim() &&
            process.env.NAVER_SEARCHAD_CUSTOMER_ID?.trim(),
        ),
        rows: [],
        warnings: [
          `SEARCHAD_DISCOVERY_FAILED: ${searchAdSettled[0].reason instanceof Error ? searchAdSettled[0].reason.message : String(searchAdSettled[0].reason)}`,
        ],
        expansionSeeds: [] as string[],
        explorationDepth: 1,
      };

  const relatedKeywords = searchAd.rows.map((row) => row.keyword);
  // Prefer real market/SearchAd forms before AI descriptive forms so no-space market spelling wins duplicate resolution.
  const candidates = uniqueKeywordElonTexts(
    [
      ...relatedKeywords,
      ...market.marketTerms,
      ...market.bridgeSeeds,
      ...seeds,
      ...ai.keywords,
    ],
    500,
  );
  const sourceTagsByKeyword: Record<string, string[]> = {};
  const addTag = (keyword: string, tag: string) => {
    const key = compactKeywordElonKey(keyword);
    if (!key) return;
    sourceTagsByKeyword[key] = [...new Set([...(sourceTagsByKeyword[key] ?? []), tag])];
  };
  const demandExpansionKeys = new Set(searchAd.expansionSeeds.map(compactKeywordElonKey));
  for (const seed of identity.primarySeeds) addTag(seed, "primary_seed");
  for (const seed of identity.conditionalSeeds) addTag(seed, "conditional_seed");
  for (const seed of market.bridgeSeeds) addTag(seed, "market_bridge_seed");
  for (const term of market.marketTerms) addTag(term, "naver_shopping_market_term");
  for (const keyword of ai.keywords) addTag(keyword, "ai_identity_expansion");
  for (const row of searchAd.rows) {
    addTag(row.keyword, "searchad_related");
    if (row.sourceSeeds.some((seed) => demandExpansionKeys.has(compactKeywordElonKey(seed)))) {
      addTag(row.keyword, "searchad_demand_depth2");
    }
    for (const seed of row.sourceSeeds) addTag(row.keyword, `related:${seed}`);
  }

  const warnings = [
    ...market.warnings,
    ...searchAd.warnings,
    ai.warning,
    `MARKET_RECALL_SUMMARY: Bridge ${market.bridgeSeeds.length}개 · 네이버쇼핑 시장어 ${market.marketTerms.length}개 · 상품명 ${market.shoppingTitleCount}건 · SearchAd Seed ${searchAdSeeds.slice(0, 6).join(", ")}`,
  ].filter(Boolean);
  if (searchAd.expansionSeeds.length) {
    warnings.push(
      `DEMAND_DEPTH2_USED: 월검색량 상위 관련어 ${searchAd.expansionSeeds.length}개를 2차 Seed로 재탐색 (${searchAd.expansionSeeds.join(", ")})`,
    );
  }
  if (candidates.length < 10) {
    warnings.push(`DISCOVERY_LOW_RECALL: 후보 ${candidates.length}개 · 최소 목표 10개 미만`);
  }

  return {
    candidates,
    sourceTagsByKeyword,
    searchAdStats: searchAd.rows,
    searchAdConfigured: searchAd.configured,
    searchAdWarnings: [...new Set(warnings)].slice(0, 20),
    aiGeneratedCount: ai.keywords.length,
    relatedKeywordCount: relatedKeywords.length,
    demandExpansionSeeds: searchAd.expansionSeeds,
    demandExpansionSeedCount: searchAd.expansionSeeds.length,
    demandExplorationDepth: searchAd.explorationDepth,
    model: ai.model || market.model,
  };
}
