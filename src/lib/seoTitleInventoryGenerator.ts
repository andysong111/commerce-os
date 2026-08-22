import {
  KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
  KEYWORD_ELON_SEO_NOISE_TERMS,
  KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT,
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
} from "@/lib/keywordEngineElonLabSeoOutput";

export const SEO_TITLE_FULL_MARKET_SIZE = 29;
export const SEO_TITLE_DEFAULT_ROUNDS = 5;
export const SEO_TITLE_MAX_ROUNDS = 50;

export const SEO_TITLE_GROUP_QUOTAS = {
  도매1: 5,
  도매2: 3,
  도매3: 3,
  도매4: 1,
  소매1: 12,
  소매2: 5,
} as const;

export type SeoTitleProductGroup = keyof typeof SEO_TITLE_GROUP_QUOTAS;

export type SeoTitleKeywordMaterial = {
  keyword: string;
  score?: number;
  relevance?: number;
  shoppingIntent?: number;
  specificity?: number;
  qualityScore?: number;
  demandScore?: number;
  totalSearch?: number | null;
  origin?: string;
  sourceMaterials?: string[];
};

export type SeoTitleInventoryCandidate = {
  productGroup: SeoTitleProductGroup;
  title: string;
  titleFingerprint: string;
  semanticFingerprint: string;
  qualityScore: number;
  sourceMaterials: string[];
  metadata: {
    strategy: string;
    modelPosition: "first" | "after_lead";
    keywordCount: number;
    materialOrigins: string[];
  };
};

export type SeoTitleInventoryGenerationInput = {
  modelName: string;
  searchKeywords: SeoTitleKeywordMaterial[];
  extraMaterials?: string[];
  rounds?: number;
  existingTitleFingerprints?: string[];
  existingSemanticFingerprints?: string[];
};

export type SeoTitleInventoryGenerationResult = {
  rounds: number;
  targetCount: number;
  generatedCount: number;
  candidates: SeoTitleInventoryCandidate[];
  groupTargets: Record<SeoTitleProductGroup, number>;
  groupGenerated: Record<SeoTitleProductGroup, number>;
  groupShortages: Record<SeoTitleProductGroup, number>;
  materialCount: number;
  warnings: string[];
};

type RankedMaterial = Required<
  Pick<
    SeoTitleKeywordMaterial,
    | "keyword"
    | "score"
    | "relevance"
    | "shoppingIntent"
    | "specificity"
    | "qualityScore"
    | "demandScore"
  >
> & {
  origin: string;
  segment: string;
};

type GroupStrategy = {
  label: string;
  modelPosition: "first" | "after_lead";
  maxTerms: number;
  rank: (material: RankedMaterial) => number;
};

const PRODUCT_NOUN_SUFFIXES = [
  "청소브러시",
  "청소브러쉬",
  "신발주걱",
  "서랍형수납함",
  "여드름압출기",
  "계란천공기",
  "휴대용구두주걱",
  "구두주걱",
  "등산화",
  "운동화",
  "수납함",
  "수납장",
  "정리함",
  "썬캡",
  "챙모자",
  "압출기",
  "천공기",
  "브러시",
  "브러쉬",
  "스티커",
  "테이프",
  "패치",
  "골무",
  "모자",
  "주걱",
  "헤라",
  "재떨이",
  "수건",
  "파우치",
  "보관함",
  "거치대",
  "케이스",
  "커버",
  "솔",
] as const;

const GENERIC_ONLY = new Set([
  "상품",
  "제품",
  "용품",
  "도구",
  "세트",
  "붙이는",
  "부착",
  "조절",
  "미니",
  "소형",
  "대형",
]);

const BLOCKED_CANONICAL = [
  ...KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
  ...KEYWORD_ELON_SEO_NOISE_TERMS,
].map(keywordElonSeoCanonical);

const STRATEGIES: Record<SeoTitleProductGroup, GroupStrategy> = {
  도매1: {
    label: "대표 정확형",
    modelPosition: "first",
    maxTerms: 3,
    rank: (row) =>
      row.relevance * 0.42 +
      row.specificity * 0.3 +
      row.qualityScore * 0.16 +
      row.demandScore * 0.12,
  },
  도매2: {
    label: "기능·문제해결형",
    modelPosition: "after_lead",
    maxTerms: 3,
    rank: (row) =>
      row.relevance * 0.36 +
      row.specificity * 0.32 +
      row.shoppingIntent * 0.2 +
      row.qualityScore * 0.12,
  },
  도매3: {
    label: "세부 용도·형태형",
    modelPosition: "after_lead",
    maxTerms: 3,
    rank: (row) =>
      row.specificity * 0.4 +
      row.relevance * 0.33 +
      longTailScore(row.segment) * 0.17 +
      row.shoppingIntent * 0.1,
  },
  도매4: {
    label: "초간결 정확형",
    modelPosition: "first",
    maxTerms: 2,
    rank: (row) =>
      row.relevance * 0.48 +
      row.specificity * 0.34 +
      row.qualityScore * 0.18,
  },
  소매1: {
    label: "검색량·발견형",
    modelPosition: "after_lead",
    maxTerms: 3,
    rank: (row) =>
      row.demandScore * 0.34 +
      row.relevance * 0.31 +
      row.shoppingIntent * 0.22 +
      row.specificity * 0.13,
  },
  소매2: {
    label: "롱테일·정확형",
    modelPosition: "after_lead",
    maxTerms: 3,
    rank: (row) =>
      row.relevance * 0.36 +
      row.specificity * 0.28 +
      row.shoppingIntent * 0.15 +
      longTailScore(row.segment) * 0.13 +
      row.demandScore * 0.08,
  },
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function number100(value: unknown, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, numeric));
}

function demandScore(totalSearch: unknown, explicit: unknown) {
  const explicitValue = Number(explicit);
  if (Number.isFinite(explicitValue)) return number100(explicitValue);
  const numeric = Number(totalSearch);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.min(100, Math.log10(numeric + 1) * 22);
}

function longTailScore(value: string) {
  return Math.min(100, keywordElonSeoCanonical(value).length * 9);
}

function isBlocked(value: unknown) {
  const key = keywordElonSeoCanonical(value);
  return !key || BLOCKED_CANONICAL.some((blocked) => key.includes(blocked));
}

function cleanHumanPhrase(value: unknown) {
  return text(value)
    .replace(/\([^)]*[\u3400-\u9fff][^)]*\)/g, " ")
    .replace(/[\u3400-\u9fff]+/g, " ")
    .replace(/[()[\]{}<>]/g, " ")
    .replace(/[·•:;,|/\\]+/g, " ")
    .replace(/[_~`^=*#@!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSharedProductNoun(keyword: string, modelName: string) {
  const keywordKey = keywordElonSeoCanonical(keyword);
  const modelKey = keywordElonSeoCanonical(modelName);
  if (!keywordKey || !modelKey || modelKey.includes(keywordKey)) return "";
  if (keywordKey.includes(modelKey)) {
    const residual = keywordKey.replace(modelKey, "");
    return residual.length >= 2 ? residual : "";
  }
  for (const suffix of PRODUCT_NOUN_SUFFIXES) {
    const suffixKey = keywordElonSeoCanonical(suffix);
    if (
      keywordKey.endsWith(suffixKey) &&
      modelKey.endsWith(suffixKey)
    ) {
      const residual = keywordKey.slice(0, -suffixKey.length);
      return residual.length >= 2 ? residual : "";
    }
  }
  return keyword;
}

function materialFromKeyword(
  input: SeoTitleKeywordMaterial,
  modelName: string,
  originFallback: string,
): RankedMaterial | null {
  const keyword = cleanHumanPhrase(input.keyword);
  if (!keyword || isBlocked(keyword)) return null;
  const segment = cleanHumanPhrase(stripSharedProductNoun(keyword, modelName));
  const key = keywordElonSeoCanonical(segment);
  if (
    !segment ||
    key.length < 2 ||
    GENERIC_ONLY.has(key) ||
    isBlocked(segment) ||
    keywordElonSeoUtf8Bytes(segment) > 30
  ) {
    return null;
  }
  return {
    keyword,
    segment,
    origin: text(input.origin) || originFallback,
    score: number100(input.score, 65),
    relevance: number100(input.relevance, 82),
    shoppingIntent: number100(input.shoppingIntent, 75),
    specificity: number100(input.specificity, 70),
    qualityScore: number100(input.qualityScore, 65),
    demandScore: demandScore(input.totalSearch, input.demandScore),
  };
}

function buildMaterials(input: SeoTitleInventoryGenerationInput) {
  const map = new Map<string, RankedMaterial>();
  for (const row of input.searchKeywords ?? []) {
    const material = materialFromKeyword(row, input.modelName, "final_keyword");
    if (!material) continue;
    const key = keywordElonSeoCanonical(material.segment);
    const current = map.get(key);
    if (!current || material.score > current.score) map.set(key, material);
  }
  for (const value of input.extraMaterials ?? []) {
    const material = materialFromKeyword(
      {
        keyword: value,
        score: 54,
        relevance: 82,
        shoppingIntent: 72,
        specificity: 68,
        qualityScore: 56,
        demandScore: 0,
        origin: "verified_attribute",
      },
      input.modelName,
      "verified_attribute",
    );
    if (!material) continue;
    const key = keywordElonSeoCanonical(material.segment);
    if (!map.has(key)) map.set(key, material);
  }
  return [...map.values()]
    .sort((left, right) => right.score - left.score || right.relevance - left.relevance)
    .slice(0, 32);
}

function chooseCombinations<T>(values: T[], size: number) {
  const output: T[][] = [];
  const selected: T[] = [];
  const walk = (start: number) => {
    if (selected.length === size) {
      output.push([...selected]);
      return;
    }
    for (let index = start; index < values.length; index += 1) {
      selected.push(values[index]);
      walk(index + 1);
      selected.pop();
    }
  };
  walk(0);
  return output;
}

function composeTitle(
  modelName: string,
  materials: RankedMaterial[],
  position: "first" | "after_lead",
) {
  const segments = materials.map((row) => row.segment).filter(Boolean);
  const words = position === "after_lead" && segments.length
    ? [segments[0], modelName, ...segments.slice(1)]
    : [modelName, ...segments];
  return words.join(" ").replace(/\s+/g, " ").trim();
}

function canonicalOccurrences(title: string, modelName: string) {
  const titleKey = keywordElonSeoCanonical(title);
  const modelKey = keywordElonSeoCanonical(modelName);
  if (!titleKey || !modelKey) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= titleKey.length - modelKey.length) {
    const index = titleKey.indexOf(modelKey, offset);
    if (index < 0) break;
    count += 1;
    offset = index + modelKey.length;
  }
  return count;
}

function semanticFingerprint(
  productGroup: SeoTitleProductGroup,
  materials: RankedMaterial[],
) {
  const keys = materials
    .map((row) => keywordElonSeoCanonical(row.segment))
    .filter(Boolean)
    .sort();
  return `${productGroup}:${keys.join("+") || "model-only"}`;
}

function candidateQuality(strategy: GroupStrategy, materials: RankedMaterial[]) {
  if (!materials.length) return 50;
  const ranked = materials.map(strategy.rank);
  const average = ranked.reduce((sum, value) => sum + value, 0) / ranked.length;
  const diversityBonus = new Set(materials.map((row) => row.origin)).size * 1.5;
  return Math.round(Math.min(100, average + diversityBonus) * 1000) / 1000;
}

function generateGroupCandidates(
  productGroup: SeoTitleProductGroup,
  modelName: string,
  materials: RankedMaterial[],
  target: number,
  titleFingerprints: Set<string>,
  semanticFingerprints: Set<string>,
) {
  const strategy = STRATEGIES[productGroup];
  const ranked = [...materials].sort(
    (left, right) => strategy.rank(right) - strategy.rank(left) || right.score - left.score,
  );
  const candidates: SeoTitleInventoryCandidate[] = [];
  const maxCombinationSize = Math.min(strategy.maxTerms, ranked.length);

  for (let size = 1; size <= maxCombinationSize; size += 1) {
    for (const combination of chooseCombinations(ranked, size)) {
      const ordered = [...combination].sort(
        (left, right) => strategy.rank(right) - strategy.rank(left) || right.score - left.score,
      );
      const title = composeTitle(modelName, ordered, strategy.modelPosition);
      if (
        !title ||
        keywordElonSeoUtf8Bytes(title) > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT ||
        canonicalOccurrences(title, modelName) !== 1 ||
        isBlocked(title)
      ) {
        continue;
      }
      const titleFingerprint = keywordElonSeoCanonical(title);
      const semantic = semanticFingerprint(productGroup, ordered);
      if (
        !titleFingerprint ||
        titleFingerprints.has(titleFingerprint) ||
        semanticFingerprints.has(semantic)
      ) {
        continue;
      }
      titleFingerprints.add(titleFingerprint);
      semanticFingerprints.add(semantic);
      candidates.push({
        productGroup,
        title,
        titleFingerprint,
        semanticFingerprint: semantic,
        qualityScore: candidateQuality(strategy, ordered),
        sourceMaterials: ordered.map((row) => row.keyword),
        metadata: {
          strategy: strategy.label,
          modelPosition: strategy.modelPosition,
          keywordCount: ordered.length,
          materialOrigins: [...new Set(ordered.map((row) => row.origin))],
        },
      });
      if (candidates.length >= target) return candidates;
    }
  }
  return candidates;
}

export function generateSeoTitleInventory(
  input: SeoTitleInventoryGenerationInput,
): SeoTitleInventoryGenerationResult {
  const modelName = cleanHumanPhrase(input.modelName);
  if (!modelName || isBlocked(modelName)) {
    throw new Error("링크 기반 모델명이 없거나 금지·노이즈 표현을 포함합니다.");
  }
  if (keywordElonSeoUtf8Bytes(modelName) > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT) {
    throw new Error("모델명만으로 상품명 최대 50bytes를 초과합니다.");
  }

  const rounds = Math.max(
    1,
    Math.min(SEO_TITLE_MAX_ROUNDS, Math.trunc(Number(input.rounds) || SEO_TITLE_DEFAULT_ROUNDS)),
  );
  const groupTargets = Object.fromEntries(
    (Object.keys(SEO_TITLE_GROUP_QUOTAS) as SeoTitleProductGroup[]).map((group) => [
      group,
      SEO_TITLE_GROUP_QUOTAS[group] * rounds,
    ]),
  ) as Record<SeoTitleProductGroup, number>;
  const materials = buildMaterials({ ...input, modelName });
  if (!materials.length) {
    throw new Error("상품명 재고를 제조할 검증 재료가 없습니다.");
  }

  const titleFingerprints = new Set(
    (input.existingTitleFingerprints ?? []).map(keywordElonSeoCanonical).filter(Boolean),
  );
  const semanticFingerprints = new Set(
    (input.existingSemanticFingerprints ?? []).map(text).filter(Boolean),
  );
  const candidates: SeoTitleInventoryCandidate[] = [];
  const groupGenerated = {} as Record<SeoTitleProductGroup, number>;
  const groupShortages = {} as Record<SeoTitleProductGroup, number>;

  for (const group of Object.keys(SEO_TITLE_GROUP_QUOTAS) as SeoTitleProductGroup[]) {
    const generated = generateGroupCandidates(
      group,
      modelName,
      materials,
      groupTargets[group],
      titleFingerprints,
      semanticFingerprints,
    );
    candidates.push(...generated);
    groupGenerated[group] = generated.length;
    groupShortages[group] = Math.max(0, groupTargets[group] - generated.length);
  }

  const warnings: string[] = [];
  for (const group of Object.keys(groupShortages) as SeoTitleProductGroup[]) {
    if (groupShortages[group] > 0) {
      warnings.push(`${group} 상품명 재고가 목표보다 ${groupShortages[group]}개 부족합니다.`);
    }
  }
  if (warnings.length) {
    warnings.push(
      "검증 재료가 부족한 경우 억지 수식어를 만들지 않습니다. STEP 5 또는 추가 시장어 수집으로 재료를 확장하세요.",
    );
  }

  return {
    rounds,
    targetCount: SEO_TITLE_FULL_MARKET_SIZE * rounds,
    generatedCount: candidates.length,
    candidates,
    groupTargets,
    groupGenerated,
    groupShortages,
    materialCount: materials.length,
    warnings,
  };
}
