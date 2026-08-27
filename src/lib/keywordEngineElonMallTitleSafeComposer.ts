import {
  KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
  KEYWORD_ELON_SEO_NOISE_TERMS,
  KEYWORD_ELON_SEO_SEARCH_TERM_BYTE_LIMIT,
  KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT,
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
  type KeywordElonSeoMarket,
} from "./keywordEngineElonLabSeoOutput.ts";

const TARGET_MIN_TITLE_BYTES = 27;
const MAX_FACTS = 48;
const GENERIC_FACTS = new Set([
  "상품",
  "제품",
  "옵션",
  "기타",
  "생활",
  "건강",
  "잡화",
  "패션잡화",
  "용품",
  "색상",
  "발송",
]);
const OPTION_ONLY_FACTS = new Set(["블랙", "화이트", "그레이", "회색", "검정", "흰색"]);
const MARKETPLACE_TERMS = [
  "쿠팡",
  "스마트스토어",
  "네이버",
  "옥션",
  "지마켓",
  "11번가",
  "에이블리",
  "도매꾹",
  "도매매",
  "오너클랜",
  "인터파크",
] as const;
const PRODUCT_NOUN_SUFFIXES = [
  "스텝퍼",
  "브러쉬",
  "브러시",
  "수납함",
  "수납장",
  "정리함",
  "마사지기",
  "안마기",
  "지압판",
  "발판",
  "썬캡",
  "선캡",
  "모자",
  "거치대",
  "케이스",
  "커버",
  "수첩",
  "노트",
  "파우치",
  "테이블",
  "서랍",
  "솔",
  "캡",
] as const;

export type KeywordElonMallTitleFactContext = {
  modelNumber?: string;
  productName: string;
  category?: string;
  optionText?: string;
  detailHtml?: string;
  mainImageUrl?: string;
  additionalImageUrls?: string[];
};

export type KeywordElonSafeMallTitleRow = {
  productGroup: string;
  groupSuffix: string;
  marketName: string;
  mallKey: string;
  accountIdLabel: string;
  title: string;
  byteLength: number;
  modelName: string;
  modelPosition: "first" | "after_lead";
  usedMaterials: string[];
  keywordMaterials: string[];
  titleKeywordSegments: string[];
  strategyLabel: string;
  variantIndex: number;
};

export type KeywordElonMallTitleSafeComposerResult = {
  rows: KeywordElonSafeMallTitleRow[];
  facts: string[];
  keywordCoverageCount: number;
  keywordCoverageTotal: number;
  uniqueTitleCount: number;
  nearDuplicateCount: number;
  warnings: string[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function clean(value: unknown) {
  return text(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[\u3400-\u9fff]+/g, " ")
    .replace(/[·•:;,|/\\]+/g, " ")
    .replace(/[_~`^=*#@!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: unknown[], limit = MAX_FACTS) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = clean(value);
    const key = keywordElonSeoCanonical(normalized);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function modelCodeLike(value: string, modelNumber = "") {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  const model = modelNumber.replace(/\s+/g, "").toUpperCase();
  if (!compact) return false;
  if (model && compact === model) return true;
  if (/^\d{10,}$/.test(compact)) return true;
  if (/^[A-Z]{2,}\d{3,}$/.test(compact)) return true;
  if (/^[A-Z]{2,}\d+(?:-\d+)+$/.test(compact)) return true;
  if (/^(?:B|SKU|CODE)[:_-]?[A-Z0-9-]{4,}$/i.test(compact)) return true;
  return false;
}

function suspiciousCompositeFact(value: string) {
  const compact = value.replace(/\s+/g, "");
  if (/^[가-힣]{15,}$/.test(compact)) return true;
  if (/^[A-Za-z0-9]{14,}$/.test(compact) && !/^\d+(?:MM|CM|ML|L|P)$/i.test(compact)) {
    return true;
  }
  return false;
}

function blockedFact(value: string, blockedKeys: string[], modelNumber: string) {
  const key = keywordElonSeoCanonical(value);
  if (!key || key.length < 2) return true;
  if (GENERIC_FACTS.has(key)) return true;
  if (modelCodeLike(value, modelNumber)) return true;
  if (suspiciousCompositeFact(value)) return true;
  if (MARKETPLACE_TERMS.some((term) => key.includes(keywordElonSeoCanonical(term)))) return true;
  return blockedKeys.some((term) => term && key.includes(term));
}

function materialParts(value: unknown) {
  const normalized = clean(value);
  if (!normalized) return [];
  const words = normalized.split(/\s+/).filter(Boolean);
  const result: string[] = [normalized];
  result.push(...words);
  for (let index = 0; index < words.length - 1; index += 1) {
    result.push(`${words[index]} ${words[index + 1]}`);
  }
  return result;
}

function htmlFacts(html: string) {
  if (!html) return [];
  const result: string[] = [];
  for (const match of html.matchAll(/(?:alt|title)\s*=\s*["']([^"']+)["']/gi)) {
    result.push(...materialParts(match[1]));
  }
  const withoutTags = html.replace(/<[^>]*>/g, " ");
  result.push(...materialParts(withoutTags));
  for (const match of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    result.push(...urlFacts(match[1]));
  }
  return result;
}

function urlFacts(url: string) {
  const decoded = safeDecode(text(url));
  if (!decoded) return [];
  const result: string[] = [];
  for (const match of decoded.matchAll(/[가-힣]{2,12}/g)) result.push(match[0]);
  return result;
}

function optionFacts(optionText: string) {
  const lines = text(optionText)
    .split(/[\n,;|/]+/)
    .map(clean)
    .filter(Boolean);
  const result: string[] = [];
  for (const line of lines) {
    for (const part of materialParts(line)) {
      const key = keywordElonSeoCanonical(part);
      if (OPTION_ONLY_FACTS.has(key)) continue;
      result.push(part);
    }
  }
  return result;
}

function pickAnchor(productName: string, facts: string[], finalKeywords: string[]) {
  const productParts = materialParts(productName)
    .filter((value) => !suspiciousCompositeFact(value));
  const candidates = unique([...productParts, ...facts, ...finalKeywords], 80);
  const scored = candidates.map((value, index) => {
    const key = keywordElonSeoCanonical(value);
    let score = 0;
    if (productParts.some((part) => keywordElonSeoCanonical(part) === key)) score += 40;
    if (PRODUCT_NOUN_SUFFIXES.some((suffix) => key.endsWith(keywordElonSeoCanonical(suffix)))) score += 50;
    if (value.includes(" ")) score += 8;
    score += Math.min(18, key.length);
    score -= index * 0.05;
    return { value, score };
  });
  scored.sort((left, right) => right.score - left.score);
  return scored[0]?.value ?? finalKeywords[0] ?? "";
}

function factPool(
  context: KeywordElonMallTitleFactContext,
  finalKeywords: string[],
  blockedTerms: string[],
) {
  const blockedKeys = unique([
    ...KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
    ...KEYWORD_ELON_SEO_NOISE_TERMS,
    ...blockedTerms,
  ], 160).map(keywordElonSeoCanonical);
  const raw: string[] = [];
  raw.push(...materialParts(context.productName));
  for (const categoryPart of text(context.category).split(/[>\/]+/)) {
    raw.push(...materialParts(categoryPart));
  }
  raw.push(...optionFacts(context.optionText ?? ""));
  raw.push(...htmlFacts(context.detailHtml ?? ""));
  raw.push(...urlFacts(context.mainImageUrl ?? ""));
  for (const url of context.additionalImageUrls ?? []) raw.push(...urlFacts(url));

  const keywordKeys = new Set(finalKeywords.map(keywordElonSeoCanonical));
  const facts = unique(raw, 120).filter((value) => {
    if (blockedFact(value, blockedKeys, context.modelNumber ?? "")) return false;
    const key = keywordElonSeoCanonical(value);
    if (keywordKeys.has(key)) return false;
    if (keywordElonSeoUtf8Bytes(value) > 32) return false;
    return true;
  });
  return facts.slice(0, MAX_FACTS);
}

function overlap(left: string, right: string) {
  const leftKey = keywordElonSeoCanonical(left);
  const rightKey = keywordElonSeoCanonical(right);
  return Boolean(
    leftKey
    && rightKey
    && (leftKey === rightKey || leftKey.includes(rightKey) || rightKey.includes(leftKey)),
  );
}

function addSegment(target: string[], value: string, required = false) {
  const normalized = text(value);
  if (!normalized) return;
  if (!required && target.some((current) => overlap(current, normalized))) return;
  const candidate = [...target, normalized].join(" ");
  if (keywordElonSeoUtf8Bytes(candidate) <= KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT) {
    target.push(normalized);
  }
}

function fitPattern(
  pattern: string[],
  primary: string,
  fillers: string[],
) {
  const segments: string[] = [];
  for (const value of pattern) addSegment(segments, value, value === primary);
  if (!segments.some((value) => keywordElonSeoCanonical(value) === keywordElonSeoCanonical(primary))) {
    segments.unshift(primary);
  }
  if (keywordElonSeoUtf8Bytes(segments.join(" ")) > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT) {
    while (segments.length > 1 && keywordElonSeoUtf8Bytes(segments.join(" ")) > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT) {
      const removable = segments.findLastIndex(
        (value) => keywordElonSeoCanonical(value) !== keywordElonSeoCanonical(primary),
      );
      if (removable < 0) break;
      segments.splice(removable, 1);
    }
  }
  for (const filler of fillers) {
    if (keywordElonSeoUtf8Bytes(segments.join(" ")) >= TARGET_MIN_TITLE_BYTES) break;
    addSegment(segments, filler);
  }
  return segments.join(" ").trim();
}

function tokenSet(value: string) {
  return new Set(value.split(/\s+/).map(keywordElonSeoCanonical).filter(Boolean));
}

function jaccard(left: string, right: string) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function candidateScore(candidate: string, usedTitles: string[]) {
  const key = keywordElonSeoCanonical(candidate);
  const exactDuplicate = usedTitles.some((title) => keywordElonSeoCanonical(title) === key);
  const maxSimilarity = usedTitles.reduce(
    (max, title) => Math.max(max, jaccard(candidate, title)),
    0,
  );
  const bytes = keywordElonSeoUtf8Bytes(candidate);
  const shortPenalty = bytes < TARGET_MIN_TITLE_BYTES ? (TARGET_MIN_TITLE_BYTES - bytes) * 2 : 0;
  const longPenalty = Math.abs(42 - bytes) * 0.12;
  return (exactDuplicate ? 10_000 : 0) + maxSimilarity * 100 + shortPenalty + longPenalty;
}

function titleCandidates(input: {
  index: number;
  primary: string;
  keywords: string[];
  facts: string[];
  anchor: string;
}) {
  const { index, primary, keywords, facts, anchor } = input;
  const keywordCount = Math.max(1, keywords.length);
  const factCount = Math.max(1, facts.length);
  const secondaryPool = [1, 3, 5, 7]
    .map((step) => keywords[(index * step + 1) % keywordCount])
    .filter((value) => value && keywordElonSeoCanonical(value) !== keywordElonSeoCanonical(primary));
  const tertiaryPool = [2, 4, 6]
    .map((step) => keywords[(index * step + 2) % keywordCount])
    .filter((value) => value && keywordElonSeoCanonical(value) !== keywordElonSeoCanonical(primary));
  const factPoolForRow = facts.length
    ? [0, 5, 11, 17].map((step) => facts[(index + step) % factCount]).filter(Boolean)
    : [];
  const fillers = unique([
    ...secondaryPool,
    ...tertiaryPool,
    ...factPoolForRow,
    anchor,
    ...keywords,
    ...facts,
  ], 60);
  const candidates: string[] = [];
  const add = (pattern: string[]) => {
    const title = fitPattern(pattern, primary, fillers);
    if (!title || keywordElonSeoUtf8Bytes(title) > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT) return;
    candidates.push(title);
  };

  const secondary = secondaryPool[0] ?? "";
  const tertiary = tertiaryPool[0] ?? "";
  const fact = factPoolForRow[0] ?? "";
  const fact2 = factPoolForRow[1] ?? "";
  const patterns = [
    [primary, anchor, secondary, fact],
    [anchor, primary, fact, secondary],
    [primary, fact, secondary, anchor],
    [secondary, primary, anchor, fact],
    [fact, primary, secondary, anchor],
    [primary, secondary, fact2, tertiary],
    [tertiary, primary, fact, secondary],
    [primary, fact2, tertiary, anchor],
    [fact2, anchor, primary, secondary],
    [secondary, fact, primary, tertiary],
  ];
  for (const pattern of patterns) add(pattern.filter(Boolean));

  for (const secondaryValue of secondaryPool) {
    for (const factValue of factPoolForRow) {
      add([primary, secondaryValue, factValue, anchor]);
      add([factValue, primary, anchor, secondaryValue]);
    }
  }
  return unique(candidates, 80);
}

function nearDuplicateCount(titles: string[]) {
  let count = 0;
  for (let index = 0; index < titles.length; index += 1) {
    for (let previous = 0; previous < index; previous += 1) {
      if (jaccard(titles[index], titles[previous]) >= 0.8) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

function validateFinalKeywords(finalKeywords: string[], context: KeywordElonMallTitleFactContext, blockedTerms: string[]) {
  const blockedKeys = unique([
    ...KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
    ...KEYWORD_ELON_SEO_NOISE_TERMS,
    ...blockedTerms,
  ], 160).map(keywordElonSeoCanonical);
  const keywords = unique(finalKeywords, 40);
  if (!keywords.length) throw new Error("쇼핑몰별 상품명에 사용할 최종키워드가 없습니다.");
  for (const keyword of keywords) {
    if (modelCodeLike(keyword, context.modelNumber ?? "")) {
      throw new Error(`쇼핑몰별 상품명 차단 · 코드형 최종키워드: ${keyword}`);
    }
    if (keywordElonSeoUtf8Bytes(keyword) > KEYWORD_ELON_SEO_SEARCH_TERM_BYTE_LIMIT) {
      throw new Error(`쇼핑몰별 상품명 차단 · 지나치게 긴 최종키워드: ${keyword}`);
    }
    const key = keywordElonSeoCanonical(keyword);
    if (blockedKeys.some((blocked) => blocked && key.includes(blocked))) {
      throw new Error(`쇼핑몰별 상품명 차단 · 금지/노이즈 최종키워드: ${keyword}`);
    }
  }
  return keywords;
}

export function composeKeywordElonSafeMallTitles(input: {
  markets: KeywordElonSeoMarket[];
  finalKeywords: string[];
  modelName: string;
  context: KeywordElonMallTitleFactContext;
  blockedTerms?: string[];
}): KeywordElonMallTitleSafeComposerResult {
  const blockedTerms = input.blockedTerms ?? [];
  const keywords = validateFinalKeywords(input.finalKeywords, input.context, blockedTerms);
  const facts = factPool(input.context, keywords, blockedTerms);
  const anchor = pickAnchor(input.context.productName, facts, keywords);
  const rows: KeywordElonSafeMallTitleRow[] = [];
  const usedTitles: string[] = [];

  for (let index = 0; index < input.markets.length; index += 1) {
    const market = input.markets[index];
    const primary = keywords[index % keywords.length];
    const candidates = titleCandidates({ index, primary, keywords, facts, anchor });
    const selected = [...candidates].sort(
      (left, right) => candidateScore(left, usedTitles) - candidateScore(right, usedTitles),
    )[0] ?? primary;
    usedTitles.push(selected);
    const selectedKey = keywordElonSeoCanonical(selected);
    const keywordMaterials = keywords.filter((keyword) =>
      selectedKey.includes(keywordElonSeoCanonical(keyword)),
    );
    const usedMaterials = unique([
      ...keywordMaterials,
      ...facts.filter((fact) => selectedKey.includes(keywordElonSeoCanonical(fact))),
      anchor,
    ], 20).filter((material) => selectedKey.includes(keywordElonSeoCanonical(material)));
    rows.push({
      productGroup: market.productGroup,
      groupSuffix: market.groupSuffix,
      marketName: market.marketName,
      mallKey: market.mallKey,
      accountIdLabel: market.accountIdLabel,
      title: selected,
      byteLength: keywordElonSeoUtf8Bytes(selected),
      modelName: input.modelName,
      modelPosition: index % 2 === 0 ? "first" : "after_lead",
      usedMaterials,
      keywordMaterials,
      titleKeywordSegments: keywordMaterials,
      strategyLabel: "safe-final-keyword-coverage-v2",
      variantIndex: index,
    });
  }

  const coverage = keywords.filter((keyword) => {
    const key = keywordElonSeoCanonical(keyword);
    return rows.some((row) => keywordElonSeoCanonical(row.title).includes(key));
  });
  if (coverage.length !== keywords.length) {
    const missing = keywords.filter((keyword) => !coverage.includes(keyword));
    throw new Error(`쇼핑몰별 상품명 최종키워드 커버 실패: ${missing.join(", ")}`);
  }

  for (const row of rows) {
    if (modelCodeLike(row.title, input.context.modelNumber ?? "")) {
      throw new Error(`쇼핑몰별 상품명에 코드형 값이 포함되었습니다: ${row.title}`);
    }
    if (keywordElonSeoUtf8Bytes(row.title) > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT) {
      throw new Error(`쇼핑몰별 상품명이 ${KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT}bytes를 초과했습니다.`);
    }
  }

  const uniqueTitleCount = new Set(rows.map((row) => keywordElonSeoCanonical(row.title))).size;
  const nearDuplicates = nearDuplicateCount(rows.map((row) => row.title));
  const warnings: string[] = [
    `SEO_MALL_TITLE_SAFE_FACTS:${facts.length}`,
    `SEO_MALL_TITLE_KEYWORD_COVERAGE:${coverage.length}/${keywords.length}`,
  ];
  if (uniqueTitleCount < rows.length) {
    warnings.push(`SEO_MALL_TITLE_EXACT_DUPLICATES_REMAIN:${rows.length - uniqueTitleCount}`);
  }
  if (nearDuplicates) warnings.push(`SEO_MALL_TITLE_NEAR_DUPLICATES_REMAIN:${nearDuplicates}`);
  if (rows.some((row) => row.byteLength < TARGET_MIN_TITLE_BYTES)) {
    warnings.push("SEO_MALL_TITLE_SHORT_ONLY_WHEN_FACTS_INSUFFICIENT");
  }

  return {
    rows,
    facts,
    keywordCoverageCount: coverage.length,
    keywordCoverageTotal: keywords.length,
    uniqueTitleCount,
    nearDuplicateCount: nearDuplicates,
    warnings,
  };
}
