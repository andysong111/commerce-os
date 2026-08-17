import {
  calculateKeywordElonQuality,
  compactKeywordElonKey,
  keywordElonUtf8Bytes,
  normalizeKeywordElonText,
  parse1688OfferId,
  uniqueKeywordElonTexts,
  validate1688Url,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonIdentity,
  type KeywordElonSearchAdStat,
  type KeywordElonSemanticScore,
  type KeywordElonSourceDraft,
  type KeywordElonTitleResult,
} from "@/lib/keywordEngineElonLabV2";
import { discoverKeywordElonSearchAd } from "@/lib/keywordEngineElonLabV2SearchAd";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 45_000;
const SOURCE_TIMEOUT_MS = 14_000;
const DEFAULT_MODEL = "gpt-5-mini";

type OpenAiPayload = {
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

async function callOpenAiJson(input: {
  system: string;
  user: unknown;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
}) {
  const apiKey = normalizeKeywordElonText(process.env.OPENAI_API_KEY);
  if (!apiKey) throw new Error("OPENAI_API_KEY가 설정되지 않아 AI 분석을 실행할 수 없습니다.");
  const model = openAiModel();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: input.maxOutputTokens ?? 6000,
        input: [
          { role: "system", content: [{ type: "input_text", text: input.system }] },
          { role: "user", content: [{ type: "input_text", text: JSON.stringify(input.user, null, 2) }] },
        ],
        text: {
          format: {
            type: "json_schema",
            name: input.schemaName,
            strict: true,
            schema: input.schema,
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
      throw new Error(`OpenAI가 JSON이 아닌 응답을 반환했습니다: ${raw.replace(/\s+/g, " ").slice(0, 180)}`);
    }
    if (!response.ok) {
      throw new Error(normalizeKeywordElonText(payload.error?.message) || `OpenAI HTTP ${response.status}`);
    }
    const text = outputText(payload);
    if (!text) throw new Error("OpenAI 구조화 응답이 비어 있습니다.");
    try {
      return { data: JSON.parse(text) as Record<string, unknown>, model };
    } catch {
      throw new Error("OpenAI 구조화 응답 JSON 파싱에 실패했습니다.");
    }
  } finally {
    clearTimeout(timeout);
  }
}

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function unescapeJsonString(value: string) {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))).replace(/\\\//g, "/");
  }
}

function cleanExtracted(value: unknown, max = 500) {
  return normalizeKeywordElonText(decodeHtml(unescapeJsonString(String(value ?? "")))).slice(0, max);
}

function metaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return cleanExtracted(match[1]);
  }
  return "";
}

function jsonField(html: string, fields: string[]) {
  for (const field of fields) {
    const pattern = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i");
    const match = html.match(pattern);
    if (match?.[1]) {
      const value = cleanExtracted(match[1]);
      if (value) return value;
    }
  }
  return "";
}

function titleFromHtml(html: string) {
  const meta = metaContent(html, "og:title") || metaContent(html, "twitter:title");
  if (meta) return meta.replace(/[-_\s]*(?:1688|阿里巴巴).*$/i, "").trim();
  const json = jsonField(html, ["subject", "offerTitle", "productTitle", "title"]);
  if (json && json.length <= 300) return json;
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  return cleanExtracted(title).replace(/[-_\s]*(?:1688|阿里巴巴).*$/i, "").trim();
}

function optionTextFromHtml(html: string) {
  const values: string[] = [];
  const patterns = [
    /"prop"\s*:\s*"((?:\\.|[^"\\])*)"/gi,
    /"propName"\s*:\s*"((?:\\.|[^"\\])*)"/gi,
    /"valueName"\s*:\s*"((?:\\.|[^"\\])*)"/gi,
    /"name"\s*:\s*"((?:\\.|[^"\\])*)"/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    let guard = 0;
    while ((match = pattern.exec(html)) && guard < 160) {
      guard += 1;
      const value = cleanExtracted(match[1], 100);
      if (!value || value.length > 80 || /https?:|\.jpg|\.png|\.webp|component|module|trace|spm/i.test(value)) continue;
      if (!/[\u3400-\u9fffA-Za-z0-9]/.test(value)) continue;
      values.push(value);
    }
  }
  return uniqueKeywordElonTexts(values, 80).join(" / ");
}

function visibleTextFromHtml(html: string) {
  const stripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return normalizeKeywordElonText(decodeHtml(stripped)).slice(0, 12_000);
}

export async function collectKeywordElon1688Source(url: string): Promise<KeywordElonSourceDraft> {
  if (!validate1688Url(url)) throw new Error("1688.com 상품 링크를 입력해 주세요.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  const warnings: string[] = [];
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    const finalUrl = response.url || url;
    let finalHost = "";
    try {
      finalHost = new URL(finalUrl).hostname.toLowerCase();
    } catch {
      // handled below
    }
    if (finalHost && finalHost !== "1688.com" && !finalHost.endsWith(".1688.com")) {
      warnings.push(`1688 밖으로 리디렉션됨: ${finalHost}`);
    }
    const html = await response.text();
    if (!response.ok) warnings.push(`1688 HTTP ${response.status}`);
    if (/商品已下架|已下架|访问受限|验证码|登录后查看|请登录/.test(html)) {
      warnings.push("1688 페이지가 품절·로그인·접근제한 상태일 수 있습니다.");
    }
    const chineseTitle = titleFromHtml(html);
    const optionText = optionTextFromHtml(html);
    const supportingText = visibleTextFromHtml(html);
    if (!chineseTitle) warnings.push("자동 수집에서 중국 상품명을 찾지 못했습니다. 아래 수동 입력을 사용해 주세요.");
    if (!optionText) warnings.push("자동 수집에서 옵션명을 충분히 찾지 못했습니다. 필요하면 옵션을 직접 붙여넣어 주세요.");
    const autoStatus = chineseTitle && optionText ? "success" : chineseTitle || supportingText ? "partial" : "failed";
    return {
      url,
      offerId: parse1688OfferId(url),
      autoStatus,
      chineseTitle,
      optionText,
      supportingText,
      warnings,
      collectedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "1688 자동 수집 실패";
    return {
      url,
      offerId: parse1688OfferId(url),
      autoStatus: "failed",
      chineseTitle: "",
      optionText: "",
      supportingText: "",
      warnings: [`자동 수집 실패: ${message}`, "중국 상품명과 옵션명을 직접 붙여넣으면 STEP 1을 계속할 수 있습니다."],
      collectedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function identitySchema() {
  const list = { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 60 } };
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "koreanProductIdentity",
      "coreProduct",
      "identityAnchor",
      "primarySeeds",
      "conditionalSeeds",
      "functionModifiers",
      "designShapeModifiers",
      "specAttributes",
      "variantNoise",
      "confidence",
      "reasoning",
    ],
    properties: {
      koreanProductIdentity: { type: "string", minLength: 1, maxLength: 100 },
      coreProduct: { type: "string", minLength: 1, maxLength: 50 },
      identityAnchor: { type: "string", minLength: 1, maxLength: 80 },
      primarySeeds: { ...list, minItems: 1 },
      conditionalSeeds: list,
      functionModifiers: list,
      designShapeModifiers: list,
      specAttributes: list,
      variantNoise: list,
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reasoning: { type: "string", minLength: 1, maxLength: 500 },
    },
  };
}

export async function analyzeKeywordElonIdentity(source: KeywordElonSourceDraft): Promise<KeywordElonIdentity> {
  const chineseTitle = normalizeKeywordElonText(source.chineseTitle);
  const optionText = normalizeKeywordElonText(source.optionText);
  const supportingText = normalizeKeywordElonText(source.supportingText).slice(0, 6000);
  if (!chineseTitle && !optionText) {
    throw new Error("STEP 1에는 중국 상품명 또는 중국 옵션정보가 필요합니다.");
  }
  const { data, model } = await callOpenAiJson({
    schemaName: "keyword_elon_1688_identity_v2",
    schema: identitySchema(),
    system: [
      "당신은 한국 이커머스용 상품 정체성 분석기다.",
      "판매자가 만든 한국 모델명은 절대 사용하지 않는다. 입력된 1688 중국 원본 상품명·옵션·보조텍스트만 근거로 판단한다.",
      "목표는 번역문을 그대로 seed로 쓰는 것이 아니라 '실제로 무엇을 파는 상품인가'를 한국어로 정확히 확정하는 것이다.",
      "coreProduct는 물건 자체를 뜻하는 가장 명확한 한국어 상품명사다.",
      "identityAnchor는 coreProduct만으로 너무 넓을 때 실제 상품 정체성을 보존하는 최소 구문이다.",
      "primarySeeds는 반드시 시장 탐색해야 하는 핵심 seed다. coreProduct와 identityAnchor를 중심으로 1~5개만 엄선한다.",
      "conditionalSeeds는 디자인·형상·기능 조합처럼 시장 데이터가 좋을 때 승격할 수 있는 seed다.",
      "색상, A/B형, 번호, 포장단위처럼 상품 정체성에 영향이 적은 옵션은 variantNoise로 보낸다.",
      "옵션 중 재질·규격·기능처럼 실제 상품 종류를 바꾸는 정보는 버리지 않는다.",
      "중국어의 마케팅 과장, 공장용 문구, 도매 문구를 한국 검색어로 번역해 발명하지 않는다.",
      "근거가 부족한 속성·성별·용도·브랜드·효능을 추가하지 않는다.",
    ].join("\n"),
    user: {
      sourceUrl: source.url,
      chineseTitle,
      optionText,
      supportingText,
      task: "1688 원본에서 상품 정체성과 한국 시장 탐색 seed를 확정",
    },
    maxOutputTokens: 3500,
  });
  const arr = (key: string) => uniqueKeywordElonTexts(Array.isArray(data[key]) ? (data[key] as unknown[]) : [], 12);
  const coreProduct = normalizeKeywordElonText(data.coreProduct);
  const identityAnchor = normalizeKeywordElonText(data.identityAnchor) || coreProduct;
  const primarySeeds = uniqueKeywordElonTexts([coreProduct, identityAnchor, ...arr("primarySeeds")], 8);
  if (!coreProduct || !primarySeeds.length) throw new Error("상품 정체성 분석 결과에서 핵심 상품어를 확정하지 못했습니다.");
  return {
    koreanProductIdentity: normalizeKeywordElonText(data.koreanProductIdentity) || identityAnchor,
    coreProduct,
    identityAnchor,
    primarySeeds,
    conditionalSeeds: arr("conditionalSeeds"),
    functionModifiers: arr("functionModifiers"),
    designShapeModifiers: arr("designShapeModifiers"),
    specAttributes: arr("specAttributes"),
    variantNoise: arr("variantNoise"),
    confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
    reasoning: normalizeKeywordElonText(data.reasoning).slice(0, 500),
    model,
  };
}

function keywordGenerationSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["keywords"],
    properties: {
      keywords: {
        type: "array",
        minItems: 10,
        maxItems: 100,
        items: { type: "string", minLength: 1, maxLength: 60 },
      },
    },
  };
}

export async function discoverKeywordElonCandidates(
  source: KeywordElonSourceDraft,
  identity: KeywordElonIdentity,
): Promise<KeywordElonDiscovery> {
  const seeds = uniqueKeywordElonTexts([...identity.primarySeeds, ...identity.conditionalSeeds], 8);
  const [aiResult, searchAd] = await Promise.all([
    callOpenAiJson({
      schemaName: "keyword_elon_candidate_pool_v2",
      schema: keywordGenerationSchema(),
      system: [
        "당신은 한국 쇼핑 검색어 후보 발굴기다.",
        "목표는 최종 10개를 고르는 것이 아니라 실제 구매자가 이 상품을 찾을 때 쓸 수 있는 후보를 넓고 다양하게 수집하는 것이다.",
        "상품과 다른 물건, 브랜드 발명, 근거 없는 성별·효능·재질·규격은 금지한다.",
        "동의어, 일반적인 시장명, 기능 조합, 디자인 조합, 용도 조합을 폭넓게 제시하되 상품 정체성에서 벗어나지 않는다.",
        "한 단어 속성만으로 상품이 무엇인지 알 수 없는 표현은 피한다.",
        "한국 소비자가 실제 검색창에 입력할 법한 짧은 명사구를 만든다.",
        "가능하면 50~80개를 제안한다. 품질 판단과 커트라인은 다음 단계가 한다.",
      ].join("\n"),
      user: {
        chineseTitle: source.chineseTitle,
        optionText: source.optionText,
        productIdentity: identity.koreanProductIdentity,
        coreProduct: identity.coreProduct,
        identityAnchor: identity.identityAnchor,
        primarySeeds: identity.primarySeeds,
        conditionalSeeds: identity.conditionalSeeds,
      },
      maxOutputTokens: 5000,
    }),
    discoverKeywordElonSearchAd(seeds),
  ]);

  const aiKeywords = uniqueKeywordElonTexts(Array.isArray(aiResult.data.keywords) ? (aiResult.data.keywords as unknown[]) : [], 120);
  const relatedKeywords = searchAd.rows.map((row) => row.keyword);
  const candidates = uniqueKeywordElonTexts([...seeds, ...aiKeywords, ...relatedKeywords], 500);
  const sourceTagsByKeyword: Record<string, string[]> = {};
  const addTag = (keyword: string, tag: string) => {
    const key = compactKeywordElonKey(keyword);
    if (!key) return;
    sourceTagsByKeyword[key] = [...new Set([...(sourceTagsByKeyword[key] ?? []), tag])];
  };
  for (const seed of identity.primarySeeds) addTag(seed, "primary_seed");
  for (const seed of identity.conditionalSeeds) addTag(seed, "conditional_seed");
  for (const keyword of aiKeywords) addTag(keyword, "ai_identity_expansion");
  for (const row of searchAd.rows) {
    addTag(row.keyword, "searchad_related");
    for (const seed of row.sourceSeeds) addTag(row.keyword, `related:${seed}`);
  }
  return {
    candidates,
    sourceTagsByKeyword,
    searchAdStats: searchAd.rows,
    searchAdConfigured: searchAd.configured,
    searchAdWarnings: searchAd.warnings,
    aiGeneratedCount: aiKeywords.length,
    relatedKeywordCount: relatedKeywords.length,
    model: aiResult.model,
  };
}

function scoringSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["scores"],
    properties: {
      scores: {
        type: "array",
        minItems: 1,
        maxItems: 60,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["keyword", "relevance", "shoppingIntent", "specificity", "titleEligible", "rationale"],
          properties: {
            keyword: { type: "string", minLength: 1, maxLength: 60 },
            relevance: { type: "number", minimum: 0, maximum: 100 },
            shoppingIntent: { type: "number", minimum: 0, maximum: 100 },
            specificity: { type: "number", minimum: 0, maximum: 100 },
            titleEligible: { type: "boolean" },
            rationale: { type: "string", minLength: 1, maxLength: 240 },
          },
        },
      },
    },
  };
}

async function scoreChunk(
  keywords: string[],
  source: KeywordElonSourceDraft,
  identity: KeywordElonIdentity,
): Promise<{ scores: KeywordElonSemanticScore[]; model: string }> {
  const result = await callOpenAiJson({
    schemaName: "keyword_elon_semantic_scores_v2",
    schema: scoringSchema(),
    system: [
      "당신은 한국 이커머스 키워드 품질 심사관이다.",
      "각 후보를 독립적으로 0~100으로 평가한다.",
      "relevance: 1688 원본의 바로 그 상품을 찾는 표현인지. 다른 상품/너무 넓은 상위개념은 크게 감점한다.",
      "shoppingIntent: 구매·상품탐색 의도가 강한 명사구인지. 정보성·행동문·증상문은 감점한다.",
      "specificity: 상품을 식별할 만큼 구체적인지. 의미 없는 옵션코드나 속성 단독은 낮게 준다.",
      "titleEligible: 실제 상품명에 넣어도 원본 사실을 왜곡하지 않고 자연스러운 표현일 때만 true다.",
      "검색량은 여기서 추측하지 않는다. 수요점수는 서버가 SearchAd 데이터로 별도 계산한다.",
      "브랜드, 성별, 재질, 용도, 효능을 원본 근거 없이 추론하면 안 된다.",
    ].join("\n"),
    user: {
      chineseTitle: source.chineseTitle,
      optionText: source.optionText,
      productIdentity: identity.koreanProductIdentity,
      coreProduct: identity.coreProduct,
      identityAnchor: identity.identityAnchor,
      keywords,
    },
    maxOutputTokens: 5500,
  });
  const raw = Array.isArray(result.data.scores) ? (result.data.scores as unknown[]) : [];
  const byKey = new Map<string, KeywordElonSemanticScore>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const keyword = normalizeKeywordElonText(row.keyword);
    const key = compactKeywordElonKey(keyword);
    if (!key) continue;
    byKey.set(key, {
      keyword,
      relevance: Math.max(0, Math.min(100, Number(row.relevance) || 0)),
      shoppingIntent: Math.max(0, Math.min(100, Number(row.shoppingIntent) || 0)),
      specificity: Math.max(0, Math.min(100, Number(row.specificity) || 0)),
      titleEligible: Boolean(row.titleEligible),
      rationale: normalizeKeywordElonText(row.rationale).slice(0, 240),
    });
  }
  const scores = keywords.map((keyword) => {
    const found = byKey.get(compactKeywordElonKey(keyword));
    return (
      found ?? {
        keyword,
        relevance: 0,
        shoppingIntent: 0,
        specificity: 0,
        titleEligible: false,
        rationale: "AI 점수 응답 누락",
      }
    );
  });
  return { scores, model: result.model };
}

function statMap(stats: KeywordElonSearchAdStat[]) {
  return new Map(stats.map((row) => [compactKeywordElonKey(row.keyword), row] as const));
}

export async function scoreKeywordElonCandidates(input: {
  source: KeywordElonSourceDraft;
  identity: KeywordElonIdentity;
  discovery: KeywordElonDiscovery;
}) {
  const candidates = uniqueKeywordElonTexts(input.discovery.candidates, 500);
  if (!candidates.length) throw new Error("점수화할 키워드 후보가 없습니다.");
  const chunks: string[][] = [];
  for (let index = 0; index < candidates.length; index += 50) chunks.push(candidates.slice(index, index + 50));
  const scoredChunks = await Promise.all(chunks.map((chunk) => scoreChunk(chunk, input.source, input.identity)));
  const semantic = scoredChunks.flatMap((chunk) => chunk.scores);
  const stats = statMap(input.discovery.searchAdStats);
  const result: KeywordElonCandidate[] = semantic.map((row) => {
    const key = compactKeywordElonKey(row.keyword);
    const stat = stats.get(key);
    const calculated = calculateKeywordElonQuality({
      relevance: row.relevance,
      shoppingIntent: row.shoppingIntent,
      specificity: row.specificity,
      totalSearch: stat?.totalSearch ?? null,
      compIdx: stat?.compIdx ?? null,
      plAvgDepth: stat?.plAvgDepth ?? null,
    });
    const sourceTags = input.discovery.sourceTagsByKeyword[key] ?? [];
    const hasDemand = stat?.totalSearch !== null && stat?.totalSearch !== undefined;
    const dataConfidence: "high" | "medium" | "low" =
      hasDemand && sourceTags.length >= 2 ? "high" : hasDemand || sourceTags.length >= 2 ? "medium" : "low";
    return {
      ...row,
      searchKey: key,
      sourceTags,
      totalSearch: stat?.totalSearch ?? null,
      pcSearch: stat?.pcSearch ?? null,
      mobileSearch: stat?.mobileSearch ?? null,
      compIdx: stat?.compIdx ?? null,
      plAvgDepth: stat?.plAvgDepth ?? null,
      ...calculated,
      dataConfidence,
    };
  });
  result.sort((a, b) => b.qualityScore - a.qualityScore || (b.totalSearch ?? -1) - (a.totalSearch ?? -1));
  return { candidates: result, model: scoredChunks[0]?.model ?? openAiModel() };
}

function titleSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "usedKeywords"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 100 },
      usedKeywords: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: { type: "string", minLength: 1, maxLength: 60 },
      },
    },
  };
}

function truncateUtf8(value: string, maxBytes: number) {
  const normalized = normalizeKeywordElonText(value);
  if (keywordElonUtf8Bytes(normalized) <= maxBytes) return normalized;
  let result = "";
  for (const char of normalized) {
    const next = result + char;
    if (keywordElonUtf8Bytes(next) > maxBytes) break;
    result = next;
  }
  return result.trim();
}

export async function generateKeywordElonTitle(input: {
  source: KeywordElonSourceDraft;
  identity: KeywordElonIdentity;
  candidates: KeywordElonCandidate[];
  cutoff: number;
}): Promise<KeywordElonTitleResult> {
  const eligible = input.candidates
    .filter((row) => row.qualityScore >= input.cutoff && row.titleEligible)
    .slice(0, 16);
  const fallbackTerms = eligible.length ? eligible : input.candidates.filter((row) => row.titleEligible).slice(0, 10);
  if (!fallbackTerms.length) {
    const title = truncateUtf8(input.identity.identityAnchor || input.identity.coreProduct, 100);
    return {
      title,
      usedKeywords: [input.identity.identityAnchor || input.identity.coreProduct].filter(Boolean),
      byteLength: keywordElonUtf8Bytes(title),
      model: "deterministic_fallback",
      warning: "TITLE_ELIGIBLE_KEYWORD_INSUFFICIENT",
    };
  }

  try {
    const result = await callOpenAiJson({
      schemaName: "keyword_elon_title_v2",
      schema: titleSchema(),
      system: [
        "당신은 한국 쇼핑 상품명 조립기다.",
        "상품명을 새로 상상하지 말고 제공된 고득점 titleEligible 키워드를 우선 재료로 사용한다.",
        "중복 의미는 제거하고 사람이 읽기 자연스러운 상품명으로 만든다.",
        "1688 원본에 없는 브랜드·재질·성별·효능·규격을 추가하지 않는다.",
        "핵심 상품 정체성을 반드시 유지한다.",
        "최종 UTF-8 100 bytes 이하를 목표로 한다.",
      ].join("\n"),
      user: {
        chineseTitle: input.source.chineseTitle,
        optionText: input.source.optionText,
        productIdentity: input.identity.koreanProductIdentity,
        coreProduct: input.identity.coreProduct,
        identityAnchor: input.identity.identityAnchor,
        rankedKeywords: fallbackTerms.map((row) => ({ keyword: row.keyword, score: row.qualityScore })),
      },
      maxOutputTokens: 1500,
    });
    const title = truncateUtf8(normalizeKeywordElonText(result.data.title), 100);
    const allowed = new Set(fallbackTerms.map((row) => compactKeywordElonKey(row.keyword)));
    const usedKeywords = uniqueKeywordElonTexts(
      (Array.isArray(result.data.usedKeywords) ? (result.data.usedKeywords as unknown[]) : []).filter((item) =>
        allowed.has(compactKeywordElonKey(item)),
      ),
      12,
    );
    return {
      title: title || truncateUtf8(input.identity.identityAnchor, 100),
      usedKeywords: usedKeywords.length ? usedKeywords : fallbackTerms.slice(0, 4).map((row) => row.keyword),
      byteLength: keywordElonUtf8Bytes(title || input.identity.identityAnchor),
      model: result.model,
      warning: "",
    };
  } catch (error) {
    const terms = uniqueKeywordElonTexts([
      input.identity.identityAnchor,
      ...fallbackTerms.slice(0, 5).map((row) => row.keyword),
    ], 6);
    const title = truncateUtf8(terms.join(" "), 100);
    return {
      title,
      usedKeywords: terms,
      byteLength: keywordElonUtf8Bytes(title),
      model: "deterministic_fallback",
      warning: `AI 상품명 생성 fallback: ${error instanceof Error ? error.message : "unknown"}`,
    };
  }
}
