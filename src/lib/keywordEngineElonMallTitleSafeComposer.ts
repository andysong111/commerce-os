import {
  KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
  KEYWORD_ELON_SEO_NOISE_TERMS,
  KEYWORD_ELON_SEO_SEARCH_TERM_BYTE_LIMIT,
  KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT,
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
  type KeywordElonSeoMarket,
} from "./keywordEngineElonLabSeoOutput.ts";

const TARGET_TITLE_BYTES = 36;
const MAX_CANDIDATES = 20_000;

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

type TitleCandidate = {
  title: string;
  segments: string[];
  canonical: string;
  byteLength: number;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function clean(value: unknown) {
  return text(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[\u3400-\u9fff]+/g, " ")
    .replace(/[·•:;,|/\\]+/g, " ")
    .replace(/[_~`^=*#@!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: unknown[], limit = 120) {
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

function validateFinalKeywords(
  finalKeywords: string[],
  context: KeywordElonMallTitleFactContext,
  blockedTerms: string[],
) {
  const blockedKeys = unique([
    ...KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
    ...KEYWORD_ELON_SEO_NOISE_TERMS,
    ...blockedTerms,
  ], 160).map(keywordElonSeoCanonical);
  const keywords = unique(finalKeywords, 40);
  if (!keywords.length) {
    throw new Error("쇼핑몰별 상품명에 사용할 최종키워드가 없습니다.");
  }
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

function buildCandidatePool(keywords: string[]) {
  const result: TitleCandidate[] = [];
  const seen = new Set<string>();
  const maxLength = Math.min(4, keywords.length);

  const append = (segments: string[]) => {
    const title = segments.join(" ").replace(/\s+/g, " ").trim();
    const canonical = keywordElonSeoCanonical(title);
    const byteLength = keywordElonSeoUtf8Bytes(title);
    if (
      !canonical ||
      seen.has(canonical) ||
      byteLength > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT
    ) {
      return;
    }
    seen.add(canonical);
    result.push({ title, segments: [...segments], canonical, byteLength });
  };

  for (let length = 2; length <= maxLength; length += 1) {
    const selected: string[] = [];
    const used = new Set<number>();
    const walk = () => {
      if (result.length >= MAX_CANDIDATES) return;
      if (selected.length === length) {
        append(selected);
        return;
      }
      for (let index = 0; index < keywords.length; index += 1) {
        if (used.has(index)) continue;
        used.add(index);
        selected.push(keywords[index]);
        walk();
        selected.pop();
        used.delete(index);
        if (result.length >= MAX_CANDIDATES) return;
      }
    };
    walk();
  }
  for (const keyword of keywords) append([keyword]);
  return result;
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

function candidateScore(input: {
  candidate: TitleCandidate;
  primary: string;
  rowIndex: number;
  keywordUsage: Map<string, number>;
}) {
  const { candidate, primary, rowIndex, keywordUsage } = input;
  const primaryKey = keywordElonSeoCanonical(primary);
  const containsPrimary = candidate.segments.some(
    (segment) => keywordElonSeoCanonical(segment) === primaryKey,
  );
  const preferredFirst = rowIndex % 2 === 0;
  const primaryFirst = keywordElonSeoCanonical(candidate.segments[0]) === primaryKey;
  const primaryPlacementPenalty = preferredFirst === primaryFirst ? 0 : 3;
  const usagePenalty = candidate.segments.reduce(
    (sum, segment) => sum + (keywordUsage.get(keywordElonSeoCanonical(segment)) ?? 0),
    0,
  );
  const lengthPenalty = Math.abs(TARGET_TITLE_BYTES - candidate.byteLength) * 0.15;
  return (
    (containsPrimary ? 0 : 10_000) +
    primaryPlacementPenalty +
    usagePenalty * 2 +
    lengthPenalty
  );
}

function selectCandidate(input: {
  candidates: TitleCandidate[];
  usedCanonical: Set<string>;
  primary: string;
  rowIndex: number;
  keywordUsage: Map<string, number>;
}) {
  let best: TitleCandidate | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of input.candidates) {
    if (input.usedCanonical.has(candidate.canonical)) continue;
    const score = candidateScore({
      candidate,
      primary: input.primary,
      rowIndex: input.rowIndex,
      keywordUsage: input.keywordUsage,
    });
    if (
      score < bestScore ||
      (score === bestScore &&
        (!best || candidate.canonical.localeCompare(best.canonical, "ko") < 0))
    ) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export function composeKeywordElonSafeMallTitles(input: {
  markets: KeywordElonSeoMarket[];
  finalKeywords: string[];
  modelName: string;
  context: KeywordElonMallTitleFactContext;
  blockedTerms?: string[];
}): KeywordElonMallTitleSafeComposerResult {
  const blockedTerms = input.blockedTerms ?? [];
  const keywords = validateFinalKeywords(
    input.finalKeywords,
    input.context,
    blockedTerms,
  );
  const candidates = buildCandidatePool(keywords);
  if (candidates.length < input.markets.length) {
    throw new Error(
      `최종키워드만으로 고유 쇼핑몰별 상품명 ${input.markets.length}개를 만들 수 없습니다. 현재 ${candidates.length}개`,
    );
  }

  const rows: KeywordElonSafeMallTitleRow[] = [];
  const usedCanonical = new Set<string>();
  const keywordUsage = new Map<string, number>();

  for (let index = 0; index < input.markets.length; index += 1) {
    const market = input.markets[index];
    const primary = keywords[index % keywords.length];
    const selected = selectCandidate({
      candidates,
      usedCanonical,
      primary,
      rowIndex: index,
      keywordUsage,
    });
    if (!selected) {
      throw new Error("최종키워드 전용 쇼핑몰 상품명 후보가 부족합니다.");
    }

    usedCanonical.add(selected.canonical);
    for (const segment of selected.segments) {
      const key = keywordElonSeoCanonical(segment);
      keywordUsage.set(key, (keywordUsage.get(key) ?? 0) + 1);
    }
    rows.push({
      productGroup: market.productGroup,
      groupSuffix: market.groupSuffix,
      marketName: market.marketName,
      mallKey: market.mallKey,
      accountIdLabel: market.accountIdLabel,
      title: selected.title,
      byteLength: selected.byteLength,
      modelName: input.modelName,
      modelPosition: index % 2 === 0 ? "first" : "after_lead",
      usedMaterials: [...selected.segments],
      keywordMaterials: [...selected.segments],
      titleKeywordSegments: [...selected.segments],
      strategyLabel: "final-keywords-only-v3",
      variantIndex: index,
    });
  }

  const coverage = keywords.filter((keyword) => {
    const key = keywordElonSeoCanonical(keyword);
    return rows.some((row) =>
      row.keywordMaterials.some(
        (material) => keywordElonSeoCanonical(material) === key,
      ),
    );
  });
  if (coverage.length !== keywords.length) {
    const missing = keywords.filter((keyword) => !coverage.includes(keyword));
    throw new Error(`쇼핑몰별 상품명 최종키워드 커버 실패: ${missing.join(", ")}`);
  }

  const allowedKeys = new Set(keywords.map(keywordElonSeoCanonical));
  for (const row of rows) {
    if (keywordElonSeoUtf8Bytes(row.title) > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT) {
      throw new Error(`쇼핑몰별 상품명이 ${KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT}bytes를 초과했습니다.`);
    }
    if (
      row.keywordMaterials.some(
        (material) => !allowedKeys.has(keywordElonSeoCanonical(material)),
      )
    ) {
      throw new Error(`쇼핑몰별 상품명에 최종키워드 외 재료가 포함되었습니다: ${row.title}`);
    }
  }

  const uniqueTitleCount = new Set(rows.map((row) => keywordElonSeoCanonical(row.title))).size;
  if (uniqueTitleCount !== rows.length) {
    throw new Error("최종키워드 전용 쇼핑몰 상품명에 중복이 발생했습니다.");
  }
  const nearDuplicates = nearDuplicateCount(rows.map((row) => row.title));

  return {
    rows,
    facts: [],
    keywordCoverageCount: coverage.length,
    keywordCoverageTotal: keywords.length,
    uniqueTitleCount,
    nearDuplicateCount: nearDuplicates,
    warnings: [
      "SEO_MALL_TITLE_SOURCE:FINAL_KEYWORDS_ONLY_V3",
      `SEO_MALL_TITLE_KEYWORD_COVERAGE:${coverage.length}/${keywords.length}`,
      ...(nearDuplicates
        ? [`SEO_MALL_TITLE_NEAR_DUPLICATES_REMAIN:${nearDuplicates}`]
        : []),
    ],
  };
}
