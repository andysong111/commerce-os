import {
  compactKeywordElonKey,
  keywordElonUtf8Bytes,
  normalizeKeywordElonText,
  type KeywordElonCandidate,
  type KeywordElonIdentity,
  type KeywordElonSourceDraft,
} from "@/lib/keywordEngineElonLabV2";
import { filterKeywordElonProhibitedKeywords } from "@/lib/keywordEngineElonLabV2Step4";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 35_000;
const DEFAULT_MODEL = "gpt-5-mini";
const TARGET_CANDIDATES = 24;
const SEARCH_TERM_BYTE_LIMIT = 30;
const FACTUAL_TOKEN_BYTE_LIMIT = 18;
const FACTUAL_PAIR_TOKEN_LIMIT = 12;

const FACTUAL_TOKEN_STOPWORDS = new Set([
  "상품",
  "제품",
  "용품",
  "옵션",
  "모델",
  "모델번호",
  "번호",
  "단품",
  "세트",
  "구성",
  "기타",
  "일반",
  "사용",
  "사용용",
  "관련",
  "배가",
  "둥근",
  "큰",
  "작은",
  "대형",
  "중형",
  "소형",
  "모양",
  "오려진",
]);

type OpenAiPayload = {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }>;
  error?: { message?: unknown };
};

export type KeywordElonBulkKeywordRecoveryInput = {
  identity: KeywordElonIdentity;
  source: KeywordElonSourceDraft;
  productName: string;
  customBlockedTerms: string[];
};

function openAiModel() {
  return (
    normalizeKeywordElonText(process.env.OPENAI_KEYWORD_ELON_MODEL)
    || normalizeKeywordElonText(process.env.OPENAI_KEYWORD_IDENTITY_MODEL)
    || normalizeKeywordElonText(process.env.OPENAI_MODEL)
    || DEFAULT_MODEL
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

function uniqueKeys(values: unknown[], limit = 60) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = compactKeywordElonKey(value);
    if (
      key.length < 2
      || /\d/.test(key)
      || keywordElonUtf8Bytes(key) > SEARCH_TERM_BYTE_LIMIT
      || seen.has(key)
    ) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeFactualToken(value: unknown) {
  let key = compactKeywordElonKey(value);
  if (key.endsWith("형") && key.length >= 5) key = key.slice(0, -1);
  if (
    key.length < 2
    || /\d/.test(key)
    || !/[가-힣]/.test(key)
    || keywordElonUtf8Bytes(key) > FACTUAL_TOKEN_BYTE_LIMIT
    || FACTUAL_TOKEN_STOPWORDS.has(key)
  ) {
    return "";
  }
  return key;
}

function factualTokens(input: KeywordElonBulkKeywordRecoveryInput) {
  const identity = input.identity;
  const phrases = [
    input.productName,
    identity.coreProduct,
    identity.identityAnchor,
    ...identity.primarySeeds,
    identity.koreanProductIdentity,
    ...identity.conditionalSeeds,
    ...identity.functionModifiers,
    ...identity.designShapeModifiers,
    ...identity.specAttributes,
    input.source.chineseTitle,
    input.source.optionText,
  ];
  const tokens: string[] = [];
  for (const phrase of phrases) {
    for (const token of normalizeKeywordElonText(phrase)
      .replace(/[^0-9A-Za-z가-힣]+/g, " ")
      .split(/\s+/)) {
      const normalized = normalizeFactualToken(token);
      if (normalized) tokens.push(normalized);
    }
  }
  return uniqueKeys(tokens, 30);
}

export function buildDeterministicBulkKeywordRecoverySeeds(
  input: KeywordElonBulkKeywordRecoveryInput,
) {
  const identity = input.identity;
  const core = compactKeywordElonKey(identity.coreProduct);
  const seeds: unknown[] = [
    core,
    identity.identityAnchor,
    ...identity.primarySeeds,
    identity.koreanProductIdentity,
    ...identity.conditionalSeeds,
    ...identity.functionModifiers,
    ...identity.designShapeModifiers,
    ...identity.specAttributes,
  ];
  const tokens = factualTokens(input);
  const modifiers = tokens
    .filter(
      (token) =>
        token !== core &&
        !token.includes(core) &&
        !core.includes(token),
    )
    .slice(0, FACTUAL_PAIR_TOKEN_LIMIT);

  if (core) {
    for (const token of modifiers) {
      seeds.push(`${token}${core}`);
    }
    for (let left = 0; left < modifiers.length; left += 1) {
      for (let right = left + 1; right < modifiers.length; right += 1) {
        seeds.push(`${modifiers[left]}${modifiers[right]}${core}`);
      }
    }
  }

  return uniqueKeys(seeds, 60);
}

function recoverySchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["keywords"],
    properties: {
      keywords: {
        type: "array",
        minItems: 10,
        maxItems: TARGET_CANDIDATES,
        items: { type: "string", minLength: 2, maxLength: 30 },
      },
    },
  };
}

async function aiSeeds(input: KeywordElonBulkKeywordRecoveryInput) {
  const apiKey = normalizeKeywordElonText(process.env.KEYWORD_ENGINE_OPENAI_API_KEY);
  if (!apiKey) return [] as string[];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openAiModel(),
        store: false,
        max_output_tokens: 2_200,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: [
                "당신은 한국 이커머스 검색어 보충 생성기다.",
                "상품 정체성과 직접 관련된 구매·상품 탐색 검색어만 만든다.",
                "브랜드명·상표명·경쟁사명은 절대 새로 만들지 않는다.",
                "의료기기·치료·진단, 임산부·임신·출산, 유아·영아·아동용품, 성인용품·성적 용도 표현은 절대 만들지 않는다.",
                "원본에 없는 효능·인증·재질·규격·대상을 상상하지 않는다.",
                "색상·수량·모델번호처럼 검색 가치가 낮은 변형어만으로 채우지 않는다.",
                "각 검색어는 한국어 중심의 짧은 상품 검색어로 만들고 서로 의미가 겹치지 않게 한다.",
                "각 검색어는 UTF-8 30bytes 이하가 되도록 짧게 만든다.",
                `가능하면 ${TARGET_CANDIDATES}개의 서로 다른 후보를 반환한다.`,
              ].join("\n"),
            }],
          },
          {
            role: "user",
            content: [{
              type: "input_text",
              text: JSON.stringify({
                productName: input.productName,
                koreanProductIdentity: input.identity.koreanProductIdentity,
                coreProduct: input.identity.coreProduct,
                identityAnchor: input.identity.identityAnchor,
                primarySeeds: input.identity.primarySeeds,
                conditionalSeeds: input.identity.conditionalSeeds,
                functionModifiers: input.identity.functionModifiers,
                designShapeModifiers: input.identity.designShapeModifiers,
                specAttributes: input.identity.specAttributes,
                sourceTitle: input.source.chineseTitle,
                sourceOptions: input.source.optionText,
              }),
            }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "keyword_elon_bulk_keyword_recovery_v2",
            strict: true,
            schema: recoverySchema(),
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
      return [];
    }
    if (!response.ok) return [];
    const resultText = outputText(payload);
    if (!resultText) return [];
    const parsed = JSON.parse(resultText) as { keywords?: unknown[] };
    return uniqueKeys(parsed.keywords ?? [], TARGET_CANDIDATES);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function asCandidates(keywords: string[]): KeywordElonCandidate[] {
  return keywords.map((keyword) => ({
    keyword,
    searchKey: keyword,
    searchKeyword: keyword,
    relevance: 90,
    shoppingIntent: 82,
    specificity: 78,
    titleEligible: true,
    rationale: "SEO 대량등록 FINAL 검색어 부족 자동복구 후보",
    sourceTags: ["bulk_keyword_recovery"],
    totalSearch: null,
    pcSearch: null,
    mobileSearch: null,
    compIdx: null,
    plAvgDepth: null,
    demandScore: 15,
    competitionOpportunity: 55,
    qualityScore: 84,
    safetyPass: true,
    safetyReason: "STEP4 재검증 전 복구 후보",
    dataConfidence: "low",
  }));
}

export async function generateSafeBulkKeywordSupplements(
  input: KeywordElonBulkKeywordRecoveryInput,
) {
  const deterministic = buildDeterministicBulkKeywordRecoverySeeds(input);
  const generated =
    deterministic.length >= TARGET_CANDIDATES
      ? []
      : await aiSeeds(input);
  const candidates = uniqueKeys([...deterministic, ...generated], 60);
  if (!candidates.length) return [];

  const filtered = await filterKeywordElonProhibitedKeywords({
    identity: input.identity,
    candidates: asCandidates(candidates),
    customBlockedTerms: input.customBlockedTerms,
  });
  const allowed = new Set(filtered.allowedKeys.map((value) => compactKeywordElonKey(value)));
  return candidates
    .filter((keyword) => allowed.has(compactKeywordElonKey(keyword)))
    .slice(0, 30);
}
