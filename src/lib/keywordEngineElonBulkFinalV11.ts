import {
  compactKeywordElonKey,
  normalizeKeywordElonText,
} from "./keywordEngineElonLabV2.ts";
import { keywordElonSeoUtf8Bytes } from "./keywordEngineElonLabSeoOutput.ts";
import {
  composeKeywordElonBulkFinal as composeKeywordElonBulkFinalBase,
  type KeywordElonBulkComposeInput,
  type KeywordElonBulkFinalResult,
} from "./keywordEngineElonBulkFinal.ts";

export {
  SEO_TITLE_EXPANSION_META_GROUP_KEY,
  collectKeywordElonBulkSource,
  generateKeywordElonBulkFinal,
} from "./keywordEngineElonBulkFinal.ts";
export type {
  KeywordElonBulkComposeInput,
  KeywordElonBulkFinalInput,
  KeywordElonBulkFinalResult,
} from "./keywordEngineElonBulkFinal.ts";

const SEARCH_TERM_BYTE_LIMIT = 30;
const GROUNDED_SUPPORT_LIMIT = 24;
const GENERIC_FACT_WORDS = new Set([
  "상품",
  "제품",
  "모델",
  "모델번호",
  "번호",
  "재질",
  "용도",
  "기능",
  "형태",
  "속성",
  "구성",
  "옵션",
  "색상",
  "사이즈",
  "선택사항",
  "표준",
]);

function text(value: unknown) {
  return normalizeKeywordElonText(value).replace(/\s+/g, " ").trim();
}

function codeLike(value: string, modelNumber: string) {
  const key = value.replace(/\s+/g, "").toUpperCase();
  const model = modelNumber.replace(/\s+/g, "").toUpperCase();
  if (!key) return true;
  if (model && key === model) return true;
  if (/^\d{10,}$/.test(key)) return true;
  if (/^[A-Z]{2,}\d{3,}(?:-\d+)*$/.test(key)) return true;
  return false;
}

function phraseFragments(value: unknown) {
  const normalized = text(value)
    .replace(/[()\[\]{}]/g, " ")
    .replace(/[·•:;,|/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [] as string[];

  const words = normalized
    .split(/\s+/)
    .map((word) => compactKeywordElonKey(word))
    .filter((word) => word.length >= 2 && !GENERIC_FACT_WORDS.has(word));
  if (!words.length) return [];

  const out: string[] = [];
  const add = (parts: string[]) => {
    const keyword = compactKeywordElonKey(parts.join(""));
    if (
      keyword.length >= 2 &&
      keywordElonSeoUtf8Bytes(keyword) <= SEARCH_TERM_BYTE_LIMIT &&
      !out.includes(keyword)
    ) {
      out.push(keyword);
    }
  };

  add(words);
  for (let width = Math.min(3, words.length); width >= 1; width -= 1) {
    for (let start = 0; start + width <= words.length; start += 1) {
      add(words.slice(start, start + width));
    }
  }
  return out;
}

export function buildKeywordElonGroundedTitleSupportsV11(
  input: KeywordElonBulkComposeInput,
) {
  const identity = input.identity;
  const phrases: unknown[] = [
    input.titleResult.title,
    identity.coreProduct,
    identity.identityAnchor,
    identity.koreanProductIdentity,
    ...identity.primarySeeds,
    ...identity.conditionalSeeds,
    ...identity.functionModifiers,
    ...identity.designShapeModifiers,
    ...identity.specAttributes,
  ];
  const blocked = [
    ...(input.blockedKeys ?? []),
    ...(input.customBlockedTerms ?? []),
  ]
    .map(compactKeywordElonKey)
    .filter((value) => value.length >= 2);
  const seen = new Set<string>();
  const supports: string[] = [];

  for (const phrase of phrases) {
    for (const keyword of phraseFragments(phrase)) {
      if (
        seen.has(keyword) ||
        codeLike(keyword, input.modelNumber) ||
        blocked.some((term) => keyword.includes(term))
      ) {
        continue;
      }
      seen.add(keyword);
      supports.push(keyword);
      if (supports.length >= GROUNDED_SUPPORT_LIMIT) return supports;
    }
  }
  return supports;
}

function uniqueSupplements(values: unknown[], limit = 30) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = compactKeywordElonKey(value);
    if (
      key.length < 2 ||
      keywordElonSeoUtf8Bytes(key) > SEARCH_TERM_BYTE_LIMIT ||
      seen.has(key)
    ) {
      continue;
    }
    seen.add(key);
    out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}

export function composeKeywordElonBulkFinal(
  input: KeywordElonBulkComposeInput,
): KeywordElonBulkFinalResult {
  // This support pool never invents a new market term. It only decomposes the already
  // verified product/title identity into short factual phrases. The normal STEP4-final
  // search pool remains authoritative; these supports are used only when sparse compose
  // needs grounded material and as a last-resort search complement.
  const groundedSupports = buildKeywordElonGroundedTitleSupportsV11(input);
  const supplementalSearchKeywords = uniqueSupplements([
    ...(input.supplementalSearchKeywords ?? []),
    ...groundedSupports,
  ]);

  return composeKeywordElonBulkFinalBase({
    ...input,
    supplementalSearchKeywords,
  });
}
