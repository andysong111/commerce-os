import {
  compactKeywordElonKey,
  keywordElonUtf8Bytes,
  normalizeKeywordElonText,
  type KeywordElonCandidate,
  type KeywordElonIdentity,
  type KeywordElonSourceDraft,
} from "./keywordEngineElonLabV2.ts";
import { filterKeywordElonProhibitedKeywords } from "./keywordEngineElonLabV2Step4.ts";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 35_000;
const DEFAULT_MODEL = "gpt-5-mini";
const TARGET_CANDIDATES = 24;
const SEARCH_TERM_BYTE_LIMIT = 30;
const MODIFIER_LIMIT = 10;

// These words describe metadata or prose structure, not something a shopper should
// type into a marketplace search box. They were the source of bad V11 terms such as
// `형태버킷햇`, `있는버킷햇`, `재질실리콘`, `용도골프공전용`.
const SEARCH_META_STOPWORDS = new Set([
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
  "선택사항",
  "표준",
  "재질",
  "용도",
  "형태",
  "속성",
  "기능",
  "있는",
  "있음",
  "모양",
  "예시",
]);

const FORBIDDEN_SYNTHETIC_FRAGMENTS = [
  "재질",
  "용도",
  "형태",
  "있는",
  "있음",
  "선택사항",
  "모델번호",
  "옵션",
] as const;

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

function openAiApiKey() {
  return String(
    process.env.KEYWORD_ENGINE_OPENAI_API_KEY
      || process.env.OPENAI_API_KEY
      || "",
  ).trim();
}

function uniqueTerms(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeKeywordElonText(value);
    const key = compactKeywordElonKey(normalized);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function isMarketplaceSearchTerm(term: string) {
  const normalized = normalizeKeywordElonText(term);
  const compact = compactKeywordElonKey(normalized);
  if (!compact || keywordElonUtf8Bytes(normalized) > SEARCH_TERM_BYTE_LIMIT) {
    return false;
  }
  if (SEARCH_META_STOPWORDS.has(compact)) return false;
  return !FORBIDDEN_SYNTHETIC_FRAGMENTS.some((fragment) =>
    compact.includes(fragment),
  );
}

function parseCandidateText(value: unknown) {
  if (typeof value !== "string") return [];
  const normalized = value
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  if (!normalized) return [];

  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => normalizeKeywordElonText(item)).filter(Boolean);
    }
    if (parsed && typeof parsed === "object") {
      const row = parsed as Record<string, unknown>;
      for (const key of ["keywords", "terms", "candidates", "searchTerms"]) {
        if (Array.isArray(row[key])) {
          return (row[key] as unknown[])
            .map((item) => normalizeKeywordElonText(item))
            .filter(Boolean);
        }
      }
    }
  } catch {
    // Fall through to line/comma parsing for plain-text model outputs.
  }

  return normalized
    .split(/[\n,;]+/)
    .map((item) => item.replace(/^\s*(?:[-*]|\d+[.)])\s*/, ""))
    .map((item) => normalizeKeywordElonText(item))
    .filter(Boolean);
}

function responseText(payload: OpenAiPayload) {
  const direct = normalizeKeywordElonText(payload.output_text);
  if (direct) return direct;
  const pieces: string[] = [];
  for (const output of payload.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        pieces.push(content.text);
      }
    }
  }
  return pieces.join("\n").trim();
}

function deterministicSeeds(input: KeywordElonBulkKeywordRecoveryInput) {
  const values = [
    input.identity.noun,
    ...input.identity.coreModifiers,
    ...input.identity.categoryHints,
    input.source.modelName,
    input.productName,
    ...input.source.options,
  ];
  return uniqueTerms(values).filter(isMarketplaceSearchTerm).slice(0, TARGET_CANDIDATES);
}

async function requestOpenAiTerms(
  input: KeywordElonBulkKeywordRecoveryInput,
  existing: string[],
) {
  const key = openAiApiKey();
  if (!key) return [];

  const blocked = uniqueTerms(input.customBlockedTerms).slice(0, 80);
  const prompt = [
    "한국 온라인 쇼핑몰 검색창에서 실제 구매자가 입력할 법한 짧은 검색어 후보를 JSON 배열로만 반환하세요.",
    "메타데이터 라벨(재질, 용도, 형태, 옵션, 모델번호 등)을 키워드 앞뒤에 붙여 합성하지 마세요.",
    "상품과 직접 관련된 일반명사/기능/형태/사용상황 위주로 작성하고, 과장·의료·상표권 위험 표현은 제외하세요.",
    `핵심 상품: ${input.identity.noun || input.source.modelName || input.productName}`,
    `보조 수식어: ${input.identity.coreModifiers.slice(0, MODIFIER_LIMIT).join(", ") || "없음"}`,
    `카테고리 힌트: ${input.identity.categoryHints.join(", ") || "없음"}`,
    `상품명: ${input.productName}`,
    `옵션: ${input.source.options.join(", ") || "없음"}`,
    `이미 확보된 검색어(중복 금지): ${existing.join(", ") || "없음"}`,
    `금지어: ${blocked.join(", ") || "없음"}`,
    `최대 ${TARGET_CANDIDATES}개, 각 검색어 UTF-8 30바이트 이하.`,
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openAiModel(),
        input: prompt,
      }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as OpenAiPayload;
    if (!response.ok) {
      throw new Error(
        normalizeKeywordElonText(payload.error?.message)
          || `OpenAI keyword recovery failed (${response.status})`,
      );
    }
    return parseCandidateText(responseText(payload));
  } finally {
    clearTimeout(timer);
  }
}

export async function recoverKeywordElonBulkCandidates(
  input: KeywordElonBulkKeywordRecoveryInput,
): Promise<KeywordElonCandidate[]> {
  const seeds = deterministicSeeds(input);
  const aiTerms = await requestOpenAiTerms(input, seeds);
  const combined = uniqueTerms([...seeds, ...aiTerms]).filter(isMarketplaceSearchTerm);
  const prohibitedFiltered = filterKeywordElonProhibitedKeywords(
    combined,
    input.customBlockedTerms,
  );
  return prohibitedFiltered
    .filter(isMarketplaceSearchTerm)
    .slice(0, TARGET_CANDIDATES)
    .map((term, index) => ({
      term,
      source: index < seeds.length ? "deterministic_recovery" : "openai_recovery",
    }));
}
