import {
  buildKeywordElonSeoPackage,
  KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
  KEYWORD_ELON_SEO_NOISE_TERMS,
  KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT,
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
  type KeywordElonSeoMarket,
  type KeywordElonSeoPackage,
  type KeywordElonSeoPackageInput,
  type KeywordElonSeoSearchKeyword,
} from "./keywordEngineElonLabSeoOutput.ts";

export const KEYWORD_ELON_SEO_MODEL_NAME_BYTE_LIMIT = 36;

export type KeywordElonSeoModelNameSource =
  | "core_product"
  | "step4_plus_core"
  | "identity_compact"
  | "step4_specific"
  | "fallback";

export type KeywordElonSeoModelPosition = "first" | "after_lead";

export type KeywordElonSeoModelGroupStrategy = {
  productGroup: string;
  label: string;
  description: string;
  variantLimit: number;
  maxKeywordTerms: number;
  modelPosition: KeywordElonSeoModelPosition;
};

export type KeywordElonSeoModelMallTitle = {
  productGroup: string;
  groupSuffix: string;
  marketName: string;
  mallKey: string;
  accountIdLabel: string;
  title: string;
  byteLength: number;
  modelName: string;
  modelPosition: KeywordElonSeoModelPosition;
  usedMaterials: string[];
  keywordMaterials: string[];
  titleKeywordSegments: string[];
  strategyLabel: string;
  variantIndex: number;
};

export type KeywordElonSeoModelPackage = Omit<
  KeywordElonSeoPackage,
  | "status"
  | "modelName"
  | "modelNameSource"
  | "modelNameByteLength"
  | "modelNameCoverageCount"
  | "modelNameByteLimit"
  | "groupStrategies"
  | "mallTitles"
  | "uniqueTitleCount"
  | "warnings"
> & {
  status: "ready" | "needs_more_keywords";
  modelName: string;
  modelNameSource: KeywordElonSeoModelNameSource;
  modelNameByteLength: number;
  modelNameCoverageCount: number;
  modelNameByteLimit: number;
  groupStrategies: KeywordElonSeoModelGroupStrategy[];
  mallTitles: KeywordElonSeoModelMallTitle[];
  uniqueTitleCount: number;
  warnings: string[];
};

type KeywordRole = "specific" | "form" | "modifier" | "generic";
type StrategyInternal = KeywordElonSeoModelGroupStrategy & {
  rank: (keyword: KeywordElonSeoSearchKeyword) => number;
};

type ModelResolution = {
  modelName: string;
  source: KeywordElonSeoModelNameSource;
};

type TitleKeyword = {
  detail: KeywordElonSeoSearchKeyword;
  segment: string;
  role: KeywordRole;
};

type TitleBuild = {
  title: string;
  usedMaterials: string[];
  keywordMaterials: string[];
  titleKeywordSegments: string[];
};

const FORM_TERMS = new Set([
  "테이프",
  "스티커",
  "패치",
  "브러시",
  "브러쉬",
  "솔",
  "도구",
  "용품",
  "세트",
  "커버",
  "케이스",
  "수납함",
  "정리함",
  "서랍",
  "수납장",
  "거치대",
  "보관함",
  "모자",
  "캡",
  "운동화",
  "신발",
  "골무",
  "압출기",
  "천공기",
  "주걱",
  "헤라",
]);

const MODIFIER_TERMS = new Set([
  "붙이는",
  "부착",
  "부착형",
  "조절",
  "조절식",
  "접이식",
  "휴대용",
  "미니",
  "소형",
  "대형",
  "콧대",
  "콧등",
]);

const GENERIC_MODEL_NAMES = new Set([
  "상품",
  "제품",
  "용품",
  "도구",
  "세트",
  ...FORM_TERMS,
]);

const MODEL_NOUN_SUFFIXES = [
  "청소브러시",
  "청소브러쉬",
  "신발주걱",
  "서랍형수납함",
  "여드름압출기",
  "계란천공기",
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
];

function normalizedText(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function cleanHumanPhrase(value: unknown) {
  return normalizedText(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[\u3400-\u9fff]+/g, " ")
    .replace(/[·•:;,|/\\]+/g, " ")
    .replace(/[_~`^=*#@!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedBlockedKeys(input: KeywordElonSeoPackageInput) {
  return [...new Set([
    ...KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
    ...KEYWORD_ELON_SEO_NOISE_TERMS,
    ...(input.blockedKeys ?? []),
    ...(input.customBlockedTerms ?? []),
  ].map(keywordElonSeoCanonical).filter((value) => value.length >= 2))];
}

function blocked(value: unknown, blockedKeys: string[]) {
  const key = keywordElonSeoCanonical(value);
  return !key || blockedKeys.some((term) => key.includes(term));
}

function fitWords(value: unknown, maxBytes: number) {
  const words = cleanHumanPhrase(value).split(/\s+/).filter(Boolean);
  const selected: string[] = [];
  for (const word of words) {
    const next = [...selected, word].join(" ");
    if (keywordElonSeoUtf8Bytes(next) > maxBytes) break;
    selected.push(word);
  }
  return selected.join(" ");
}

function fitIdentityAroundCore(value: unknown, coreKey: string, maxBytes: number) {
  const words = cleanHumanPhrase(value).split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const coreIndex = words.findIndex((word) => {
    const key = keywordElonSeoCanonical(word);
    return coreKey && (key === coreKey || key.includes(coreKey) || coreKey.includes(key));
  });
  if (coreIndex < 0) return fitWords(words.join(" "), maxBytes);

  const selected = [words[coreIndex]];
  for (let index = coreIndex - 1; index >= 0; index -= 1) {
    const next = [words[index], ...selected].join(" ");
    if (keywordElonSeoUtf8Bytes(next) > maxBytes) break;
    selected.unshift(words[index]);
  }
  for (let index = coreIndex + 1; index < words.length; index += 1) {
    const next = [...selected, words[index]].join(" ");
    if (keywordElonSeoUtf8Bytes(next) > maxBytes) break;
    selected.push(words[index]);
  }
  return selected.join(" ");
}

function humanizeKeyword(value: unknown, coreProduct: unknown) {
  const raw = cleanHumanPhrase(value);
  const key = keywordElonSeoCanonical(raw);
  const core = cleanHumanPhrase(coreProduct);
  const coreKey = keywordElonSeoCanonical(core);
  if (!key) return "";

  if (coreKey && key !== coreKey && key.endsWith(coreKey)) {
    const prefix = key.slice(0, -coreKey.length);
    if (prefix.length >= 2) return `${prefix} ${core}`.trim();
  }
  for (const suffix of MODEL_NOUN_SUFFIXES) {
    const suffixKey = keywordElonSeoCanonical(suffix);
    if (key !== suffixKey && key.endsWith(suffixKey)) {
      const prefix = key.slice(0, -suffixKey.length);
      if (prefix.length >= 2) return `${prefix} ${suffix}`.trim();
    }
  }
  return raw;
}

function isSpecificModelName(value: unknown) {
  const key = keywordElonSeoCanonical(value);
  return key.length >= 4 && !GENERIC_MODEL_NAMES.has(key);
}

function candidateModelScore(keyword: KeywordElonSeoSearchKeyword) {
  return (
    keyword.relevance * 0.45
    + keyword.specificity * 0.35
    + keyword.qualityScore * 0.20
  );
}

function resolveModelName(
  input: KeywordElonSeoPackageInput,
  finalKeywords: KeywordElonSeoSearchKeyword[],
  blockedKeys: string[],
): ModelResolution {
  const core = cleanHumanPhrase(input.identity.coreProduct);
  const coreKey = keywordElonSeoCanonical(core);
  const fittedCore = fitWords(core, KEYWORD_ELON_SEO_MODEL_NAME_BYTE_LIMIT);
  if (fittedCore && isSpecificModelName(fittedCore) && !blocked(fittedCore, blockedKeys)) {
    return { modelName: fittedCore, source: "core_product" };
  }

  const ranked = [...finalKeywords].sort((left, right) => candidateModelScore(right) - candidateModelScore(left));
  if (fittedCore && coreKey && GENERIC_MODEL_NAMES.has(coreKey)) {
    for (const keyword of ranked) {
      const keywordKey = keywordElonSeoCanonical(keyword.keyword);
      if (!keywordKey || keywordKey === coreKey) continue;
      let candidate = humanizeKeyword(keyword.keyword, core);
      const candidateKey = keywordElonSeoCanonical(candidate);
      const hasNoun = MODEL_NOUN_SUFFIXES.some((suffix) => candidateKey.endsWith(keywordElonSeoCanonical(suffix)));
      if (!hasNoun) candidate = `${candidate} ${core}`.trim();
      const fitted = fitWords(candidate, KEYWORD_ELON_SEO_MODEL_NAME_BYTE_LIMIT);
      if (fitted && isSpecificModelName(fitted) && !blocked(fitted, blockedKeys)) {
        return { modelName: fitted, source: "step4_plus_core" };
      }
    }
  }

  for (const candidate of [input.identity.koreanProductIdentity, input.identity.identityAnchor]) {
    const fitted = fitIdentityAroundCore(candidate, coreKey, KEYWORD_ELON_SEO_MODEL_NAME_BYTE_LIMIT);
    if (fitted && isSpecificModelName(fitted) && !blocked(fitted, blockedKeys)) {
      return { modelName: fitted, source: "identity_compact" };
    }
  }

  for (const keyword of ranked) {
    const candidate = humanizeKeyword(keyword.keyword, core);
    const fitted = fitWords(candidate, KEYWORD_ELON_SEO_MODEL_NAME_BYTE_LIMIT);
    const key = keywordElonSeoCanonical(fitted);
    const hasProductNoun = Boolean(
      coreKey && (key.includes(coreKey) || coreKey.includes(key))
      || MODEL_NOUN_SUFFIXES.some((suffix) => key.endsWith(keywordElonSeoCanonical(suffix))),
    );
    if (fitted && hasProductNoun && isSpecificModelName(fitted) && !blocked(fitted, blockedKeys)) {
      return { modelName: fitted, source: "step4_specific" };
    }
  }

  const fallback = fittedCore
    || fitWords(input.identity.koreanProductIdentity, KEYWORD_ELON_SEO_MODEL_NAME_BYTE_LIMIT)
    || fitWords(input.identity.identityAnchor, KEYWORD_ELON_SEO_MODEL_NAME_BYTE_LIMIT)
    || humanizeKeyword(ranked[0]?.keyword, core)
    || "상품명 확인 필요";
  return { modelName: fallback, source: "fallback" };
}

function roleForKeyword(keyword: KeywordElonSeoSearchKeyword): KeywordRole {
  const key = keywordElonSeoCanonical(keyword.keyword);
  if (FORM_TERMS.has(key)) return "form";
  if (MODIFIER_TERMS.has(key)) return "modifier";
  if (keyword.origin === "step4_pair") return "specific";
  if (key.length <= 3) return "modifier";
  if (keyword.relevance >= 88 && keyword.specificity >= 65) return "specific";
  return "generic";
}

function keywordSegment(keyword: KeywordElonSeoSearchKeyword, modelName: string) {
  const keywordKey = keywordElonSeoCanonical(keyword.keyword);
  const modelKey = keywordElonSeoCanonical(modelName);
  if (!keywordKey || !modelKey || modelKey.includes(keywordKey)) return "";
  if (keywordKey.includes(modelKey)) {
    const residual = keywordKey.replace(modelKey, "");
    return residual.length >= 2 ? residual : "";
  }
  for (const suffix of MODEL_NOUN_SUFFIXES) {
    const suffixKey = keywordElonSeoCanonical(suffix);
    if (keywordKey.endsWith(suffixKey) && modelKey.endsWith(suffixKey)) {
      const residual = keywordKey.slice(0, -suffixKey.length);
      return residual.length >= 2 ? residual : "";
    }
  }
  return keyword.keyword;
}

function demandScore(keyword: KeywordElonSeoSearchKeyword) {
  return keyword.demandScore ?? 0;
}

function longTailScore(keyword: KeywordElonSeoSearchKeyword) {
  const lengthScore = Math.min(100, keywordElonSeoCanonical(keyword.keyword).length * 10);
  return Math.min(100, lengthScore + (keyword.origin === "step4_pair" ? 15 : 0));
}

function genericPenalty(keyword: KeywordElonSeoSearchKeyword) {
  return ["form", "modifier", "generic"].includes(roleForKeyword(keyword)) ? 35 : 0;
}

const STRATEGIES: Record<string, StrategyInternal> = {
  도매1: {
    productGroup: "도매1",
    label: "대표 정확형",
    description: "링크 기반 모델명을 앞에 고정하고 상품 관련성·구체성이 가장 높은 검색어를 보조로 배치합니다.",
    variantLimit: 2,
    maxKeywordTerms: 2,
    modelPosition: "first",
    rank: (keyword) => (
      keyword.relevance * 0.45
      + keyword.specificity * 0.30
      + demandScore(keyword) * 0.15
      + keyword.shoppingIntent * 0.10
      - genericPenalty(keyword)
    ),
  },
  도매2: {
    productGroup: "도매2",
    label: "기능·문제해결형",
    description: "구체 기능 검색어를 먼저 배치하고 링크 기반 모델명을 바로 뒤에 넣어 상품 정체성을 고정합니다.",
    variantLimit: 2,
    maxKeywordTerms: 2,
    modelPosition: "after_lead",
    rank: (keyword) => (
      keyword.relevance * 0.40
      + keyword.specificity * 0.35
      + keyword.shoppingIntent * 0.15
      + demandScore(keyword) * 0.10
      + (keyword.origin === "step4_pair" ? 6 : 0)
      - genericPenalty(keyword)
    ),
  },
  도매3: {
    productGroup: "도매3",
    label: "세부 용도·형태형",
    description: "세부 용도·부위·형태 검색어를 먼저 배치하고 모델명을 이어 도매 롱테일을 분담합니다.",
    variantLimit: 2,
    maxKeywordTerms: 2,
    modelPosition: "after_lead",
    rank: (keyword) => (
      keyword.specificity * 0.42
      + keyword.relevance * 0.35
      + longTailScore(keyword) * 0.13
      + keyword.shoppingIntent * 0.10
      - genericPenalty(keyword)
    ),
  },
  도매4: {
    productGroup: "도매4",
    label: "초간결 정확형",
    description: "모델명을 앞에 두고 가장 정확한 검색어 하나만 선택해 짧고 빠르게 식별되도록 합니다.",
    variantLimit: 1,
    maxKeywordTerms: 1,
    modelPosition: "first",
    rank: (keyword) => (
      keyword.relevance * 0.50
      + keyword.specificity * 0.35
      + keyword.qualityScore * 0.15
      - genericPenalty(keyword)
    ),
  },
  소매1: {
    productGroup: "소매1",
    label: "검색량·발견형",
    description: "월검색 수요가 높은 구체 검색어를 먼저 두고 모델명을 이어 소비자 검색과 상품 식별을 동시에 잡습니다.",
    variantLimit: 4,
    maxKeywordTerms: 2,
    modelPosition: "after_lead",
    rank: (keyword) => (
      demandScore(keyword) * 0.35
      + keyword.relevance * 0.35
      + keyword.shoppingIntent * 0.20
      + keyword.specificity * 0.10
      + (keyword.totalSearch !== null ? 5 : 0)
      - genericPenalty(keyword)
    ),
  },
  소매2: {
    productGroup: "소매2",
    label: "롱테일·정확형",
    description: "관련성이 높은 긴 검색 조합을 먼저 두고 모델명을 이어 세부 소비자 검색 수요를 담당합니다.",
    variantLimit: 2,
    maxKeywordTerms: 2,
    modelPosition: "after_lead",
    rank: (keyword) => (
      keyword.relevance * 0.40
      + keyword.specificity * 0.25
      + keyword.shoppingIntent * 0.15
      + demandScore(keyword) * 0.10
      + longTailScore(keyword) * 0.10
      - genericPenalty(keyword)
    ),
  },
};

export const KEYWORD_ELON_SEO_MODEL_GROUP_STRATEGIES: KeywordElonSeoModelGroupStrategy[] = [
  "도매1",
  "도매2",
  "도매3",
  "도매4",
  "소매1",
  "소매2",
].map((productGroup) => {
  const strategy = STRATEGIES[productGroup];
  return {
    productGroup: strategy.productGroup,
    label: strategy.label,
    description: strategy.description,
    variantLimit: strategy.variantLimit,
    maxKeywordTerms: strategy.maxKeywordTerms,
    modelPosition: strategy.modelPosition,
  };
});

function segmentOverlap(left: string, right: string) {
  const leftKey = keywordElonSeoCanonical(left);
  const rightKey = keywordElonSeoCanonical(right);
  return Boolean(
    leftKey
    && rightKey
    && (leftKey === rightKey || leftKey.includes(rightKey) || rightKey.includes(leftKey))
  );
}

function composeTitle(
  modelName: string,
  keywords: TitleKeyword[],
  modelPosition: KeywordElonSeoModelPosition,
) {
  const segments = keywords.map((row) => row.segment);
  if (modelPosition === "after_lead" && segments.length) {
    return [segments[0], modelName, ...segments.slice(1)].join(" ");
  }
  return [modelName, ...segments].join(" ");
}

function titleOccurrenceCount(title: string, modelName: string) {
  return modelName ? title.split(modelName).length - 1 : 0;
}

function fitTitle(
  ordered: KeywordElonSeoSearchKeyword[],
  modelName: string,
  strategy: StrategyInternal,
): TitleBuild {
  const selected: TitleKeyword[] = [];
  for (const detail of ordered) {
    const segment = keywordSegment(detail, modelName);
    if (!segment) continue;
    const role = roleForKeyword(detail);
    if (selected.some((current) => segmentOverlap(current.segment, segment))) continue;
    if (!selected.length && strategy.modelPosition === "after_lead" && ["form", "modifier", "generic"].includes(role)) continue;
    const candidate = { detail, segment, role };
    const next = composeTitle(modelName, [...selected, candidate], strategy.modelPosition);
    if (keywordElonSeoUtf8Bytes(next) > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT) continue;
    selected.push(candidate);
    if (selected.length >= strategy.maxKeywordTerms) break;
  }

  const title = composeTitle(modelName, selected, strategy.modelPosition);
  return {
    title,
    usedMaterials: [modelName, ...selected.map((row) => row.segment)],
    keywordMaterials: selected.map((row) => row.detail.keyword),
    titleKeywordSegments: selected.map((row) => row.segment),
  };
}

function buildGroupVariants(
  strategy: StrategyInternal,
  keywords: KeywordElonSeoSearchKeyword[],
  modelName: string,
) {
  const ranked = [...keywords].sort((left, right) => (
    strategy.rank(right) - strategy.rank(left)
    || right.score - left.score
    || right.keyword.length - left.keyword.length
  ));
  const specific = ranked.filter((keyword) => {
    const segment = keywordSegment(keyword, modelName);
    return segment && roleForKeyword(keyword) === "specific";
  });
  const leadPool = specific.length ? specific : ranked.filter((keyword) => keywordSegment(keyword, modelName));
  const variants: TitleBuild[] = [];
  const seen = new Set<string>();

  for (let variantIndex = 0; variantIndex < strategy.variantLimit; variantIndex += 1) {
    for (let attempt = 0; attempt < Math.max(1, leadPool.length); attempt += 1) {
      const lead = leadPool[(variantIndex + attempt) % Math.max(1, leadPool.length)];
      const pivot = (variantIndex * 2 + attempt) % Math.max(1, ranked.length);
      const ordered = lead
        ? [lead, ...ranked.slice(pivot), ...ranked.slice(0, pivot)]
        : [...ranked.slice(pivot), ...ranked.slice(0, pivot)];
      const result = fitTitle(ordered, modelName, strategy);
      const key = keywordElonSeoCanonical(result.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      variants.push(result);
      break;
    }
  }

  if (!variants.length) variants.push(fitTitle(ranked, modelName, strategy));
  return variants;
}

export function buildKeywordElonSeoModelPackage(
  input: KeywordElonSeoPackageInput,
  markets: KeywordElonSeoMarket[],
): KeywordElonSeoModelPackage {
  const base = buildKeywordElonSeoPackage(input, markets);
  const blockedKeys = normalizedBlockedKeys(input);
  const model = resolveModelName(input, base.searchKeywordDetails, blockedKeys);
  const variantsByGroup = new Map<string, TitleBuild[]>();
  for (const group of Object.keys(STRATEGIES)) {
    variantsByGroup.set(group, buildGroupVariants(STRATEGIES[group], base.searchKeywordDetails, model.modelName));
  }

  const groupIndexes = new Map<string, number>();
  const mallTitles = markets.map((market) => {
    const strategy = STRATEGIES[market.productGroup] ?? STRATEGIES["소매1"];
    const variants = variantsByGroup.get(market.productGroup)
      ?? buildGroupVariants(strategy, base.searchKeywordDetails, model.modelName);
    const groupIndex = groupIndexes.get(market.productGroup) ?? 0;
    groupIndexes.set(market.productGroup, groupIndex + 1);
    const variantIndex = groupIndex % Math.max(1, variants.length);
    const selected = variants[variantIndex] ?? {
      title: model.modelName,
      usedMaterials: [model.modelName],
      keywordMaterials: [],
      titleKeywordSegments: [],
    };
    return {
      productGroup: market.productGroup,
      groupSuffix: market.groupSuffix,
      marketName: market.marketName,
      mallKey: market.mallKey,
      accountIdLabel: market.accountIdLabel,
      title: selected.title,
      byteLength: keywordElonSeoUtf8Bytes(selected.title),
      modelName: model.modelName,
      modelPosition: strategy.modelPosition,
      usedMaterials: selected.usedMaterials,
      keywordMaterials: selected.keywordMaterials,
      titleKeywordSegments: selected.titleKeywordSegments,
      strategyLabel: strategy.label,
      variantIndex: variantIndex + 1,
    };
  });

  const modelNameCoverageCount = mallTitles.filter((row) => (
    titleOccurrenceCount(row.title, model.modelName) === 1
  )).length;
  const warnings = [...base.warnings];
  if (model.source === "fallback") {
    warnings.push("링크 기반 모델명이 보수적 fallback으로 결정되었습니다. STEP 1 상품 정체성 결과를 확인하세요.");
  }
  if (model.source === "step4_plus_core") {
    warnings.push("STEP 1 핵심 상품명이 너무 넓어 STEP 4 구체 키워드와 결합해 링크 기반 모델명을 확정했습니다.");
  }
  if (modelNameCoverageCount !== mallTitles.length) {
    warnings.push(`링크 기반 모델명 1회 포함 검증이 ${modelNameCoverageCount}/${mallTitles.length}개입니다.`);
  }
  if (mallTitles.some((row) => !row.title || row.byteLength > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT)) {
    warnings.push("일부 쇼핑몰별 상품명이 비어 있거나 50bytes를 초과해 검토가 필요합니다.");
  }

  const uniqueTitleCount = new Set(
    mallTitles.map((row) => keywordElonSeoCanonical(row.title)).filter(Boolean),
  ).size;
  const ready = (
    base.commonSearchKeywords.length === 10
    && model.source !== "fallback"
    && mallTitles.length === markets.length
    && modelNameCoverageCount === markets.length
    && mallTitles.every((row) => row.title && row.byteLength <= KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT)
  );

  return {
    ...base,
    status: ready ? "ready" : "needs_more_keywords",
    modelName: model.modelName,
    modelNameSource: model.source,
    modelNameByteLength: keywordElonSeoUtf8Bytes(model.modelName),
    modelNameCoverageCount,
    modelNameByteLimit: KEYWORD_ELON_SEO_MODEL_NAME_BYTE_LIMIT,
    groupStrategies: KEYWORD_ELON_SEO_MODEL_GROUP_STRATEGIES,
    mallTitles,
    uniqueTitleCount,
    warnings: [...new Set(warnings)],
  };
}
