import {
  calculateKeywordElonQuality,
  compactKeywordElonKey,
  normalizeKeywordElonText,
  uniqueKeywordElonCanonical,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonIdentity,
  type KeywordElonSearchAdStat,
  type KeywordElonSemanticScore,
  type KeywordElonSourceDraft,
} from "@/lib/keywordEngineElonLabV2";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 42_000;
const DEFAULT_MODEL = "gpt-5-mini";
const SCORE_CHUNK_SIZE = 12;
const SCORE_CONCURRENCY = 1;

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
      if (content.type === "output_text" && normalizeKeywordElonText(content.text)) return normalizeKeywordElonText(content.text);
    }
  }
  return "";
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
        maxItems: SCORE_CHUNK_SIZE,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["keyword", "relevance", "shoppingIntent", "specificity", "titleEligible"],
          properties: {
            keyword: { type: "string", minLength: 1, maxLength: 60 },
            relevance: { type: "number", minimum: 0, maximum: 100 },
            shoppingIntent: { type: "number", minimum: 0, maximum: 100 },
            specificity: { type: "number", minimum: 0, maximum: 100 },
            titleEligible: { type: "boolean" },
          },
        },
      },
    },
  };
}

function scoreRationale(input: { relevance: number; shoppingIntent: number; specificity: number; titleEligible: boolean }) {
  const title = input.titleEligible ? " · 상품명사용 가능" : "";
  return `관련성 ${input.relevance.toFixed(0)} · 쇼핑의도 ${input.shoppingIntent.toFixed(0)} · 구체성 ${input.specificity.toFixed(0)}${title}`;
}

async function callScoreOpenAi(input: { keywords: string[]; source: KeywordElonSourceDraft; identity: KeywordElonIdentity }) {
  const apiKey = normalizeKeywordElonText((process.env.KEYWORD_ENGINE_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY));
  if (!apiKey) throw new Error("OPENAI_API_KEY가 설정되지 않아 AI 점수화를 실행할 수 없습니다.");
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
        max_output_tokens: 2_600,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: [
                "당신은 한국 이커머스 키워드 품질 심사관이다.",
                "각 후보를 독립적으로 0~100으로 평가한다.",
                "relevance: 1688 원본의 바로 그 상품을 찾는 표현인지. 다른 상품/너무 넓은 상위개념은 크게 감점한다.",
                "shoppingIntent: 구매·상품탐색 의도가 강한 명사구인지. 정보성·행동문·증상문은 감점한다.",
                "specificity: 상품을 식별할 만큼 구체적인지. 의미 없는 옵션코드나 속성 단독은 낮게 준다.",
                "titleEligible: 실제 상품명에 넣어도 원본 사실을 왜곡하지 않고 자연스러운 표현일 때만 true다.",
                "검색량은 여기서 추측하지 않는다. 수요점수는 서버가 SearchAd 데이터로 별도 계산한다.",
                "브랜드, 성별, 재질, 용도, 효능을 원본 근거 없이 추론하면 안 된다.",
                "설명문은 생성하지 말고 요청된 점수 필드만 반환한다.",
              ].join("\n"),
            }],
          },
          {
            role: "user",
            content: [{
              type: "input_text",
              text: JSON.stringify({
                chineseTitle: input.source.chineseTitle,
                optionText: input.source.optionText,
                productIdentity: input.identity.koreanProductIdentity,
                coreProduct: input.identity.coreProduct,
                identityAnchor: input.identity.identityAnchor,
                keywords: input.keywords,
              }, null, 2),
            }],
          },
        ],
        text: { format: { type: "json_schema", name: "keyword_elon_semantic_scores_v6", strict: true, schema: scoringSchema() } },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const raw = await response.text();
    let payload: OpenAiPayload = {};
    try { payload = JSON.parse(raw) as OpenAiPayload; } catch { throw new Error(`AI_SCORE_INVALID_JSON: ${raw.replace(/\s+/g, " ").slice(0, 180)}`); }
    if (!response.ok) throw new Error(`AI_SCORE_HTTP_${response.status}: ${normalizeKeywordElonText(payload.error?.message) || "OpenAI 요청 실패"}`);
    const status = normalizeKeywordElonText(payload.status);
    const incompleteReason = normalizeKeywordElonText(payload.incomplete_details?.reason);
    if (status === "incomplete") throw new Error(`AI_SCORE_INCOMPLETE: ${incompleteReason || "응답이 완료되지 않았습니다."}`);
    const text = outputText(payload);
    if (!text) throw new Error(`AI_SCORE_EMPTY_OUTPUT: status=${status || "unknown"}${incompleteReason ? ` reason=${incompleteReason}` : ""}`);
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { throw new Error("AI_SCORE_OUTPUT_PARSE_FAILED: OpenAI 구조화 응답 JSON 파싱에 실패했습니다."); }
    const rawScores = Array.isArray(parsed.scores) ? parsed.scores : [];
    const byKey = new Map<string, KeywordElonSemanticScore>();
    for (const item of rawScores) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      const key = compactKeywordElonKey(row.keyword);
      if (!key) continue;
      const relevance = Math.max(0, Math.min(100, Number(row.relevance) || 0));
      const shoppingIntent = Math.max(0, Math.min(100, Number(row.shoppingIntent) || 0));
      const specificity = Math.max(0, Math.min(100, Number(row.specificity) || 0));
      const titleEligible = Boolean(row.titleEligible);
      byKey.set(key, { keyword: key, relevance, shoppingIntent, specificity, titleEligible, rationale: scoreRationale({ relevance, shoppingIntent, specificity, titleEligible }) });
    }
    return {
      model,
      scores: input.keywords.map((keyword) => {
        const key = compactKeywordElonKey(keyword);
        return byKey.get(key) ?? { keyword: key, relevance: 0, shoppingIntent: 0, specificity: 0, titleEligible: false, rationale: "AI 점수 응답 누락" };
      }),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("AI_SCORE_TIMEOUT: OpenAI 점수화가 42초 안에 응답하지 않았습니다.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function scoreChunkOnce(keywords: string[], source: KeywordElonSourceDraft, identity: KeywordElonIdentity) {
  try {
    return { ok: true as const, ...(await callScoreOpenAi({ keywords, source, identity })), warning: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 점수화 실패";
    return {
      ok: false as const,
      model: openAiModel(),
      warning: message,
      scores: keywords.map<KeywordElonSemanticScore>((keyword) => ({
        keyword: compactKeywordElonKey(keyword), relevance: 0, shoppingIntent: 0, specificity: 0, titleEligible: false,
        rationale: `AI 점수화 실패 · ${message.slice(0, 120)}`,
      })),
    };
  }
}

function statMap(stats: KeywordElonSearchAdStat[]) {
  return new Map(stats.map((row) => [compactKeywordElonKey(row.keyword), row] as const));
}

export async function scoreKeywordElonCandidatesBatched(input: { source: KeywordElonSourceDraft; identity: KeywordElonIdentity; discovery: KeywordElonDiscovery }) {
  const candidates = uniqueKeywordElonCanonical(input.discovery.candidates, 500);
  if (!candidates.length) throw new Error("점수화할 키워드 후보가 없습니다.");
  const chunks: string[][] = [];
  for (let index = 0; index < candidates.length; index += SCORE_CHUNK_SIZE) chunks.push(candidates.slice(index, index + SCORE_CHUNK_SIZE));

  const scored: KeywordElonSemanticScore[] = [];
  const warnings: string[] = [];
  let model = openAiModel();
  let successfulChunks = 0;
  for (let index = 0; index < chunks.length; index += SCORE_CONCURRENCY) {
    const wave = chunks.slice(index, index + SCORE_CONCURRENCY);
    const waveResults = await Promise.all(wave.map((chunk) => scoreChunkOnce(chunk, input.source, input.identity)));
    for (const result of waveResults) {
      scored.push(...result.scores);
      model = result.model || model;
      if (result.ok) successfulChunks += 1;
      else if (result.warning) warnings.push(result.warning);
    }
  }
  if (successfulChunks === 0) throw new Error(`AI_SCORE_ALL_CHUNKS_FAILED: ${warnings[0] || "모든 AI 점수화 묶음이 실패했습니다."}`);

  const stats = statMap(input.discovery.searchAdStats);
  const result: KeywordElonCandidate[] = scored.map((row) => {
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
    const chunkFailed = row.rationale.startsWith("AI 점수화 실패");
    const dataConfidence: "high" | "medium" | "low" = chunkFailed ? "low" : hasDemand && sourceTags.length >= 2 ? "high" : hasDemand || sourceTags.length >= 2 ? "medium" : "low";
    const demandLabel = stat?.totalSearch === null || stat?.totalSearch === undefined ? "월검색 미측정" : `월검색 ${stat.totalSearch.toLocaleString()}`;
    return {
      ...row,
      keyword: key,
      rationale: `${row.rationale} · ${calculated.safetyReason} · ${demandLabel}`,
      searchKey: key,
      searchKeyword: key,
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
  result.sort((a, b) => Number(b.safetyPass) - Number(a.safetyPass) || b.qualityScore - a.qualityScore || (b.totalSearch ?? -1) - (a.totalSearch ?? -1));
  return { candidates: result, model, scoringWarnings: [...new Set(warnings)].slice(0, 10), scoringChunkCount: chunks.length, scoringConcurrency: SCORE_CONCURRENCY, scoringSuccessfulChunks: successfulChunks };
}
