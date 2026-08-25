import {
  compactKeywordElonKey,
  normalizeKeywordElonText,
  type KeywordElonCandidate,
  type KeywordElonIdentity,
  type KeywordElonSourceDraft,
} from "@/lib/keywordEngineElonLabV2";
import { filterKeywordElonProhibitedKeywords } from "@/lib/keywordEngineElonLabV2Step4";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 35_000;
const DEFAULT_MODEL = "gpt-5-mini";
const TARGET_CANDIDATES = 18;

type OpenAiPayload = {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }>;
  error?: { message?: unknown };
};

type RecoveryInput = {
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

function uniqueKeys(values: unknown[], limit = 40) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = compactKeywordElonKey(value);
    if (key.length < 2 || key.length > 18 || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}

function deterministicSeeds(input: RecoveryInput) {
  const identity = input.identity;
  const core = normalizeKeywordElonText(identity.coreProduct);
  const seeds = [
    core,
    identity.koreanProductIdentity,
    identity.identityAnchor,
    ...(identity.primarySeeds ?? []),
    ...(identity.conditionalSeeds ?? []),
  ];
  const modifiers = [
    ...(identity.functionModifiers ?? []),
    ...(identity.designShapeModifiers ?? []),
    ...(identity.specAttributes ?? []),
  ];
  if (core) {
    for (const modifier of modifiers) {
      const clean = normalizeKeywordElonText(modifier);
      if (!clean) continue;
      seeds.push(`${clean}${core}`);
      seeds.push(`${core}${clean}`);
    }
  }
  return uniqueKeys(seeds, 30);
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

async function aiSeeds(input: RecoveryInput) {
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
        max_output_tokens: 1_800,
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
            name: "keyword_elon_bulk_keyword_recovery_v1",
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
    qualityScore: 84,
    totalSearch: null,
    safetyPass: true,
    titleEligible: true,
  }));
}

export async function generateSafeBulkKeywordSupplements(input: RecoveryInput) {
  const deterministic = deterministicSeeds(input);
  const generated = await aiSeeds(input);
  const candidates = uniqueKeys([...deterministic, ...generated], 40);
  if (!candidates.length) return [];

  const filtered = await filterKeywordElonProhibitedKeywords({
    identity: input.identity,
    candidates: asCandidates(candidates),
    customBlockedTerms: input.customBlockedTerms,
  });
  const allowed = new Set(filtered.allowedKeys.map((value) => compactKeywordElonKey(value)));
  return candidates.filter((keyword) => allowed.has(compactKeywordElonKey(keyword))).slice(0, 20);
}
