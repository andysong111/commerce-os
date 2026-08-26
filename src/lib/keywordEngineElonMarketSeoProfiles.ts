import {
  KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
  KEYWORD_ELON_SEO_NOISE_TERMS,
  KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT,
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
  type KeywordElonSeoIdentity,
  type KeywordElonSeoSearchKeyword,
} from "@/lib/keywordEngineElonLabSeoOutput";

export type KeywordElonMarketSeoProfile =
  | "B2B"
  | "NAVER"
  | "COUPANG"
  | "ABLY"
  | "GENERIC_RETAIL";

type MallTitleRow = {
  productGroup: string;
  marketName: string;
  mallKey: string;
  accountIdLabel: string;
  title: string;
  modelPosition?: "first" | "after_lead";
  usedMaterials?: string[];
  keywordMaterials?: string[];
  titleKeywordSegments?: string[];
  strategyLabel?: string;
};

type GroundedMaterial = {
  value: string;
  relevance: number;
  specificity: number;
  shoppingIntent: number;
  demandScore: number;
  qualityScore: number;
  kind: "keyword" | "function" | "context" | "form" | "spec" | "identity";
};

export type KeywordElonMarketSeoProfileResult<T extends MallTitleRow> = {
  rows: T[];
  profileCounts: Record<KeywordElonMarketSeoProfile, number>;
  adjustedCount: number;
  warnings: string[];
};

const BLOCKED = [...KEYWORD_ELON_SEO_FORBIDDEN_TERMS, ...KEYWORD_ELON_SEO_NOISE_TERMS]
  .map(keywordElonSeoCanonical)
  .filter(Boolean);

const FUNCTION_PATTERN = /(청소|지압|마사지|수납|정리|보관|고정|보호|제거|세척|건조|거치|압출|천공|밀봉|차단|흡수|미끄럼방지)/i;
const CONTEXT_PATTERN = /(주방|욕실|화장실|차량|자동차|사무실|실내|야외|캠핑|여행|현관|창틀|책상|침실|거실|학교|홈트)/i;
const FORM_PATTERN = /(원형|사각|직사각|슬림|롱|미니|소형|대형|접이식|걸이형|스텝형|판형|보드형|파우치형|케이스형|브러시|브러쉬|스텝퍼|거치대|수납함|파우치|노트|수건|판)$/i;
const SPEC_PATTERN = /\b\d+(?:\.\d+)?\s*(?:mm|cm|m|ml|l|g|kg|개|매|장|쌍|세트|입|호|인치)\b/i;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function clean(value: unknown) {
  return text(value)
    .replace(/\([^)]*[\u3400-\u9fff][^)]*\)/g, " ")
    .replace(/[\u3400-\u9fff]+/g, " ")
    .replace(/[()[\]{}<>]/g, " ")
    .replace(/[·•:;,|/\\]+/g, " ")
    .replace(/[_~`^=*#@!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function number100(value: unknown, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, numeric));
}

function demand(value: KeywordElonSeoSearchKeyword) {
  const explicit = Number(value.demandScore);
  if (Number.isFinite(explicit)) return number100(explicit);
  const totalSearch = Number(value.totalSearch);
  if (!Number.isFinite(totalSearch) || totalSearch <= 0) return 0;
  return Math.min(100, Math.log10(totalSearch + 1) * 22);
}

function materialKind(value: string): GroundedMaterial["kind"] {
  if (SPEC_PATTERN.test(value)) return "spec";
  if (CONTEXT_PATTERN.test(value)) return "context";
  if (FUNCTION_PATTERN.test(value)) return "function";
  if (FORM_PATTERN.test(value)) return "form";
  return "keyword";
}

function isBlocked(value: unknown) {
  const key = keywordElonSeoCanonical(value);
  return !key || BLOCKED.some((blocked) => blocked && key.includes(blocked));
}

function uniqueMaterials(values: GroundedMaterial[]) {
  const result: GroundedMaterial[] = [];
  const seen = new Set<string>();
  for (const row of values) {
    const value = clean(row.value);
    const key = keywordElonSeoCanonical(value);
    if (!key || key.length < 2 || seen.has(key) || isBlocked(value)) continue;
    seen.add(key);
    result.push({ ...row, value });
  }
  return result;
}

function groundedMaterials(
  identity: KeywordElonSeoIdentity,
  searchKeywords: KeywordElonSeoSearchKeyword[],
  modelName: string,
  factMaterials: string[] = [],
) {
  const modelKey = keywordElonSeoCanonical(modelName);
  const rows: GroundedMaterial[] = searchKeywords.flatMap((row) => {
    const score = {
      relevance: number100(row.relevance, 80),
      specificity: number100(row.specificity, 70),
      shoppingIntent: number100(row.shoppingIntent, 70),
      demandScore: demand(row),
      qualityScore: number100(row.qualityScore, 65),
    };
    return [row.keyword, ...(row.sourceMaterials ?? [])].map((value) => ({
      value: text(value),
      ...score,
      kind: materialKind(text(value)),
    }));
  });

  const identityRows: Array<[
    unknown[] | undefined,
    GroundedMaterial["kind"],
  ]> = [
    [identity.functionModifiers, "function"],
    [identity.conditionalSeeds, "context"],
    [identity.designShapeModifiers, "form"],
    [identity.specAttributes, "spec"],
    [identity.primarySeeds, "identity"],
  ];
  for (const [values, kind] of identityRows) {
    for (const value of values ?? []) {
      rows.push({
        value: text(value),
        relevance: 86,
        specificity: kind === "spec" ? 90 : 82,
        shoppingIntent: 72,
        demandScore: 0,
        qualityScore: 74,
        kind,
      });
    }
  }

  // FACT POOL values are already restricted upstream to titleAllowed A/B facts.
  // They are intentionally not assigned fake search demand; they enrich factual
  // market-specific modifiers such as option, shape, material, size and bundle.
  for (const value of factMaterials) {
    const normalized = text(value);
    if (!normalized) continue;
    const kind = materialKind(normalized);
    rows.push({
      value: normalized,
      relevance: 88,
      specificity: kind === "spec" ? 94 : 86,
      shoppingIntent: 70,
      demandScore: 0,
      qualityScore: 80,
      kind,
    });
  }

  return uniqueMaterials(rows).filter((row) => {
    const key = keywordElonSeoCanonical(row.value);
    return key && key !== modelKey && !modelKey.includes(key);
  });
}

export function resolveKeywordElonMarketSeoProfile(input: {
  productGroup?: unknown;
  marketName?: unknown;
}): KeywordElonMarketSeoProfile {
  const market = text(input.marketName).toLocaleLowerCase();
  const group = text(input.productGroup);
  if (group.startsWith("도매") || /도매꾹|도매매|오너클랜|셀파|투비즈온/.test(market)) {
    return "B2B";
  }
  if (/스마트스토어|네이버/.test(market)) return "NAVER";
  if (/쿠팡/.test(market)) return "COUPANG";
  if (/에이블리/.test(market)) return "ABLY";
  return "GENERIC_RETAIL";
}

function profileScore(profile: KeywordElonMarketSeoProfile, row: GroundedMaterial) {
  const kindBonus = (kind: GroundedMaterial["kind"], amount: number) => row.kind === kind ? amount : 0;
  if (profile === "B2B") {
    return (
      row.relevance * 0.32 +
      row.specificity * 0.30 +
      row.shoppingIntent * 0.12 +
      row.qualityScore * 0.12 +
      row.demandScore * 0.04 +
      kindBonus("spec", 13) +
      kindBonus("function", 8) +
      kindBonus("form", 6)
    );
  }
  if (profile === "NAVER") {
    return (
      row.demandScore * 0.30 +
      row.relevance * 0.30 +
      row.specificity * 0.18 +
      row.shoppingIntent * 0.15 +
      row.qualityScore * 0.07 +
      kindBonus("context", 5)
    );
  }
  if (profile === "COUPANG") {
    return (
      row.relevance * 0.38 +
      row.specificity * 0.26 +
      row.shoppingIntent * 0.18 +
      row.qualityScore * 0.12 +
      row.demandScore * 0.06 +
      kindBonus("spec", 5)
    );
  }
  if (profile === "ABLY") {
    return (
      row.relevance * 0.28 +
      row.demandScore * 0.22 +
      row.shoppingIntent * 0.20 +
      row.specificity * 0.14 +
      row.qualityScore * 0.08 +
      kindBonus("context", 11) +
      kindBonus("form", 7)
    );
  }
  return (
    row.demandScore * 0.25 +
    row.relevance * 0.30 +
    row.shoppingIntent * 0.18 +
    row.specificity * 0.17 +
    row.qualityScore * 0.10
  );
}

function titleOccurrenceCount(title: string, modelName: string) {
  if (!modelName) return 0;
  return title.split(modelName).length - 1;
}

function validTitle(title: string, modelName: string) {
  return Boolean(
    title &&
    keywordElonSeoUtf8Bytes(title) <= KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT &&
    titleOccurrenceCount(title, modelName) === 1 &&
    !isBlocked(title)
  );
}

function candidateForProfile(
  profile: KeywordElonMarketSeoProfile,
  modelName: string,
  ranked: GroundedMaterial[],
  offset: number,
) {
  const rotated = [...ranked.slice(offset), ...ranked.slice(0, offset)];
  const first = rotated[0]?.value ?? "";
  const second = rotated.find((row) => row.value !== first)?.value ?? "";
  const third = rotated.find((row) => row.value !== first && row.value !== second)?.value ?? "";
  const attempts: string[] = [];

  if (profile === "B2B") {
    attempts.push(
      [modelName, first, second].filter(Boolean).join(" "),
      [modelName, first, third].filter(Boolean).join(" "),
      [first, modelName, second].filter(Boolean).join(" "),
    );
  } else if (profile === "NAVER") {
    attempts.push(
      [first, modelName, second].filter(Boolean).join(" "),
      [modelName, first, second].filter(Boolean).join(" "),
      [first, modelName, third].filter(Boolean).join(" "),
    );
  } else if (profile === "COUPANG") {
    attempts.push(
      [modelName, first].filter(Boolean).join(" "),
      [modelName, first, second].filter(Boolean).join(" "),
      [first, modelName].filter(Boolean).join(" "),
    );
  } else if (profile === "ABLY") {
    const context = rotated.find((row) => row.kind === "context" || row.kind === "form")?.value;
    attempts.push(
      [context || first, modelName, second].filter(Boolean).join(" "),
      [modelName, context || first, second].filter(Boolean).join(" "),
      [first, modelName, third].filter(Boolean).join(" "),
    );
  } else {
    attempts.push(
      [first, modelName, second].filter(Boolean).join(" "),
      [modelName, first, second].filter(Boolean).join(" "),
      [second, modelName, first].filter(Boolean).join(" "),
    );
  }

  return attempts.map(text).find((candidate) => validTitle(candidate, modelName)) ?? "";
}

export function applyKeywordElonMarketSeoProfiles<T extends MallTitleRow>(input: {
  rows: T[];
  modelName: string;
  identity: KeywordElonSeoIdentity;
  searchKeywords: KeywordElonSeoSearchKeyword[];
  factMaterials?: string[];
}): KeywordElonMarketSeoProfileResult<T> {
  const materials = groundedMaterials(
    input.identity,
    input.searchKeywords,
    input.modelName,
    input.factMaterials ?? [],
  );
  const used = new Set<string>();
  const profileCounts: Record<KeywordElonMarketSeoProfile, number> = {
    B2B: 0,
    NAVER: 0,
    COUPANG: 0,
    ABLY: 0,
    GENERIC_RETAIL: 0,
  };
  let adjustedCount = 0;

  const rows = input.rows.map((row, index) => {
    const profile = resolveKeywordElonMarketSeoProfile(row);
    profileCounts[profile] += 1;
    const ranked = [...materials].sort(
      (left, right) => profileScore(profile, right) - profileScore(profile, left),
    );
    let selected = text(row.title);
    for (let attempt = 0; attempt < Math.max(1, Math.min(12, ranked.length)); attempt += 1) {
      const candidate = candidateForProfile(profile, input.modelName, ranked, (index + attempt) % Math.max(1, ranked.length));
      const key = keywordElonSeoCanonical(candidate);
      if (!candidate || !key || used.has(key)) continue;
      selected = candidate;
      break;
    }
    const selectedKey = keywordElonSeoCanonical(selected);
    if (selectedKey && used.has(selectedKey)) {
      selected = text(row.title);
    }
    used.add(keywordElonSeoCanonical(selected));
    if (selected !== text(row.title)) adjustedCount += 1;
    return {
      ...row,
      title: selected,
      strategyLabel: `${text(row.strategyLabel) || "SEO"} · ${profile}`,
    };
  });

  const warnings = adjustedCount
    ? [`SEO_MARKET_PROFILE_ADJUSTED:${adjustedCount}`]
    : [];
  return { rows, profileCounts, adjustedCount, warnings };
}
