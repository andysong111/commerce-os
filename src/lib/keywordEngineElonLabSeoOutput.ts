export const KEYWORD_ELON_SEO_SEARCH_LIMIT = 10;
export const KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT = 100;
export const KEYWORD_ELON_SEO_FORBIDDEN_TERMS = ["도매", "대량", "납품"] as const;

export type KeywordElonSeoIdentity = {
  koreanProductIdentity?: string;
  coreProduct?: string;
  identityAnchor?: string;
  primarySeeds?: string[];
  conditionalSeeds?: string[];
  functionModifiers?: string[];
  designShapeModifiers?: string[];
  specAttributes?: string[];
};

export type KeywordElonSeoCandidate = {
  keyword?: string;
  searchKey?: string;
  searchKeyword?: string;
  relevance?: number;
  shoppingIntent?: number;
  specificity?: number;
  qualityScore?: number;
  totalSearch?: number | null;
};

export type KeywordElonSeoMarket = {
  productGroup: string;
  groupSuffix: string;
  productGroupType: string;
  marketName: string;
  mallType: string;
  mallKey: string;
  accountIdLabel: string;
};

export type KeywordElonSeoTitleResult = {
  title?: string;
  usedKeywords?: string[];
};

export type KeywordElonSeoMallTitle = {
  productGroup: string;
  groupSuffix: string;
  marketName: string;
  mallKey: string;
  accountIdLabel: string;
  title: string;
  byteLength: number;
  usedMaterials: string[];
};

export type KeywordElonSeoPackage = {
  status: "ready" | "needs_more_keywords";
  commonSearchKeywords: string[];
  marketDerivedKeywordCount: number;
  generatedFallbackKeywordCount: number;
  allowedMaterialCount: number;
  mallTitles: KeywordElonSeoMallTitle[];
  uniqueTitleCount: number;
  warnings: string[];
};

export type KeywordElonSeoPackageInput = {
  identity: KeywordElonSeoIdentity;
  candidates: KeywordElonSeoCandidate[];
  allowedKeys: string[];
  blockedKeys?: string[];
  customBlockedTerms?: string[];
  titleResult?: KeywordElonSeoTitleResult | null;
};

function normalizedText(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function keywordElonSeoCanonical(value: unknown) {
  return normalizedText(value)
    .replace(/[^0-9A-Za-z가-힣]/g, "")
    .toLocaleLowerCase();
}

export function keywordElonSeoUtf8Bytes(value: string) {
  return new TextEncoder().encode(value).length;
}

function cleanTitlePhrase(value: unknown) {
  return normalizedText(value)
    .replace(/\([^)]*[\u3400-\u9fff][^)]*\)/g, " ")
    .replace(/[\u3400-\u9fff]+/g, " ")
    .replace(/[()[\]{}<>]/g, " ")
    .replace(/[·•:;,|/\\]+/g, " ")
    .replace(/[_~`^=*#@!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function candidateText(row: KeywordElonSeoCandidate) {
  return normalizedText(row.searchKeyword || row.searchKey || row.keyword);
}

function candidateKey(row: KeywordElonSeoCandidate) {
  return keywordElonSeoCanonical(candidateText(row));
}

function uniqueCanonical(values: unknown[], limit = 200) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = cleanTitlePhrase(value);
    const key = keywordElonSeoCanonical(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= limit) break;
  }
  return output;
}

function normalizedBlockedKeys(input: KeywordElonSeoPackageInput) {
  return [...new Set([
    ...KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
    ...(input.blockedKeys ?? []),
    ...(input.customBlockedTerms ?? []),
  ].map(keywordElonSeoCanonical).filter((value) => value.length >= 2))];
}

function blocked(value: unknown, blockedKeys: string[]) {
  const key = keywordElonSeoCanonical(value);
  return !key || blockedKeys.some((term) => key.includes(term));
}

function safePhrase(value: unknown, blockedKeys: string[]) {
  const text = cleanTitlePhrase(value);
  const key = keywordElonSeoCanonical(text);
  if (!text || key.length < 2 || text.length > 60 || blocked(text, blockedKeys)) return "";
  return text;
}

function safeSearchTerm(value: unknown, blockedKeys: string[]) {
  const key = keywordElonSeoCanonical(value);
  if (key.length < 2 || key.length > 40 || blocked(key, blockedKeys)) return "";
  return key;
}

function addUniqueSearch(
  output: string[],
  seen: Set<string>,
  value: unknown,
  blockedKeys: string[],
) {
  if (output.length >= KEYWORD_ELON_SEO_SEARCH_LIMIT) return;
  const term = safeSearchTerm(value, blockedKeys);
  if (!term || seen.has(term)) return;
  seen.add(term);
  output.push(term);
}

function buildCommonSearchKeywords(
  input: KeywordElonSeoPackageInput,
  allowedRows: KeywordElonSeoCandidate[],
  blockedKeys: string[],
) {
  const output: string[] = [];
  const seen = new Set<string>();
  const marketKeys = new Set<string>();

  for (const row of allowedRows) {
    const term = safeSearchTerm(candidateText(row), blockedKeys);
    if (!term) continue;
    marketKeys.add(term);
    addUniqueSearch(output, seen, term, blockedKeys);
  }

  const identitySources = [
    ...(input.titleResult?.usedKeywords ?? []),
    input.identity.coreProduct,
    input.identity.identityAnchor,
    ...(input.identity.primarySeeds ?? []),
    ...(input.identity.conditionalSeeds ?? []),
    ...(input.identity.functionModifiers ?? []),
    ...(input.identity.designShapeModifiers ?? []),
    ...(input.identity.specAttributes ?? []),
  ];

  for (const source of identitySources) addUniqueSearch(output, seen, source, blockedKeys);

  const core = safeSearchTerm(input.identity.coreProduct, blockedKeys);
  const fallbackTerms = uniqueCanonical(identitySources, 60)
    .map((value) => safeSearchTerm(value, blockedKeys))
    .filter(Boolean);
  const fragments = uniqueCanonical(identitySources, 80)
    .flatMap((value) => cleanTitlePhrase(value).split(/\s+/))
    .map((value) => safeSearchTerm(value, blockedKeys))
    .filter((value) => value.length >= 2 && value.length <= 16);
  const combinationParts = [...new Set([...output, ...fallbackTerms, ...fragments])].slice(0, 24);

  if (core) {
    for (const part of combinationParts) {
      if (output.length >= KEYWORD_ELON_SEO_SEARCH_LIMIT) break;
      if (!part || part === core || core.includes(part) || part.includes(core)) continue;
      addUniqueSearch(output, seen, `${part}${core}`, blockedKeys);
      addUniqueSearch(output, seen, `${core}${part}`, blockedKeys);
    }
  }

  for (let left = 0; left < combinationParts.length; left += 1) {
    for (let right = left + 1; right < combinationParts.length; right += 1) {
      if (output.length >= KEYWORD_ELON_SEO_SEARCH_LIMIT) break;
      const first = combinationParts[left];
      const second = combinationParts[right];
      if (!first || !second || first.includes(second) || second.includes(first)) continue;
      if (first.length + second.length > 32) continue;
      addUniqueSearch(output, seen, `${first}${second}`, blockedKeys);
      addUniqueSearch(output, seen, `${second}${first}`, blockedKeys);
    }
    if (output.length >= KEYWORD_ELON_SEO_SEARCH_LIMIT) break;
  }

  const marketDerivedKeywordCount = output.filter((term) => marketKeys.has(term)).length;
  return {
    keywords: output.slice(0, KEYWORD_ELON_SEO_SEARCH_LIMIT),
    marketDerivedKeywordCount,
  };
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableShuffle(values: string[], seed: string) {
  return values
    .map((value, index) => ({
      value,
      score: stableHash(`${seed}:${value}:${index}`),
    }))
    .sort((left, right) => left.score - right.score)
    .map((row) => row.value);
}

function uniquePhrases(values: unknown[], blockedKeys: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const phrase = safePhrase(value, blockedKeys);
    const key = keywordElonSeoCanonical(phrase);
    if (!phrase || !key || seen.has(key)) continue;
    seen.add(key);
    output.push(phrase);
  }
  return output;
}

function fitTitle(phrases: string[], core: string) {
  const selected: string[] = [];
  const seen = new Set<string>();
  const ordered = uniqueCanonical([core, ...phrases], 30);
  for (const phrase of ordered) {
    const key = keywordElonSeoCanonical(phrase);
    if (!key || seen.has(key)) continue;
    const next = [...selected, phrase].join(" ");
    if (keywordElonSeoUtf8Bytes(next) > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT) continue;
    seen.add(key);
    selected.push(phrase);
    if (selected.length >= 7) break;
  }

  let title = selected.join(" ").trim();
  if (!title) title = core || "상품명 확인 필요";
  while (keywordElonSeoUtf8Bytes(title) > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT && title.length > 1) {
    title = title.slice(0, -1).trim();
  }
  return {
    title,
    usedMaterials: selected,
  };
}

function titlePools(input: KeywordElonSeoPackageInput, allowedRows: KeywordElonSeoCandidate[], blockedKeys: string[]) {
  const core = safePhrase(input.identity.coreProduct, blockedKeys)
    || safePhrase(input.identity.koreanProductIdentity, blockedKeys)
    || safePhrase(candidateText(allowedRows[0] ?? {}), blockedKeys)
    || "상품명 확인 필요";
  const anchor = uniquePhrases([input.identity.identityAnchor], blockedKeys);
  const exact = uniquePhrases([
    ...allowedRows.map(candidateText),
    ...(input.titleResult?.usedKeywords ?? []),
    ...(input.identity.primarySeeds ?? []),
    ...(input.identity.conditionalSeeds ?? []),
  ], blockedKeys);
  const functions = uniquePhrases(input.identity.functionModifiers ?? [], blockedKeys);
  const shapes = uniquePhrases(input.identity.designShapeModifiers ?? [], blockedKeys);
  const specs = uniquePhrases(input.identity.specAttributes ?? [], blockedKeys);
  return { core, anchor, exact, functions, shapes, specs };
}

function policyForGroup(
  productGroup: string,
  pools: ReturnType<typeof titlePools>,
) {
  const { core, anchor, exact, functions, shapes, specs } = pools;
  if (productGroup === "도매1") {
    return {
      leads: uniqueCanonical([core, ...specs, ...exact.slice(0, 4)]),
      materials: uniqueCanonical([core, ...specs, ...functions, ...exact, ...shapes, ...anchor]),
    };
  }
  if (productGroup === "도매2") {
    return {
      leads: uniqueCanonical([...functions, core, ...exact.slice(0, 5)]),
      materials: uniqueCanonical([...functions, core, ...exact, ...shapes, ...specs, ...anchor]),
    };
  }
  if (productGroup === "도매3") {
    return {
      leads: uniqueCanonical([...anchor, ...shapes, core, ...exact.slice(0, 5)]),
      materials: uniqueCanonical([...anchor, ...shapes, core, ...exact, ...functions, ...specs]),
    };
  }
  if (productGroup === "도매4") {
    return {
      leads: uniqueCanonical([...specs, core, ...functions, ...exact.slice(0, 4)]),
      materials: uniqueCanonical([...specs, core, ...functions, ...exact, ...shapes, ...anchor]),
    };
  }
  if (productGroup === "소매2") {
    return {
      leads: uniqueCanonical([...exact.slice(1, 8), ...functions, ...anchor, core]),
      materials: uniqueCanonical([...exact.slice(1), ...functions, ...anchor, core, ...shapes, ...specs]),
    };
  }
  return {
    leads: uniqueCanonical([...exact.slice(0, 8), ...anchor, core]),
    materials: uniqueCanonical([...exact, ...anchor, core, ...functions, ...shapes, ...specs]),
  };
}

function buildOneMallTitle(
  market: KeywordElonSeoMarket,
  groupIndex: number,
  pools: ReturnType<typeof titlePools>,
  usedTitles: Set<string>,
) {
  const policy = policyForGroup(market.productGroup, pools);
  const leads = policy.leads.length ? policy.leads : [pools.core];
  let fallback: ReturnType<typeof fitTitle> | null = null;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const lead = leads[(groupIndex + attempt) % leads.length] || pools.core;
    const shuffled = stableShuffle(
      policy.materials.filter((value) => keywordElonSeoCanonical(value) !== keywordElonSeoCanonical(lead)),
      `${market.productGroup}:${market.mallKey}:${market.accountIdLabel}:${groupIndex}:${attempt}`,
    );
    const order = market.productGroup === "도매3" || market.productGroup === "소매2"
      ? [lead, shuffled[0], pools.core, ...shuffled.slice(1)]
      : [lead, pools.core, ...shuffled];
    const result = fitTitle(order, pools.core);
    fallback = result;
    const key = keywordElonSeoCanonical(result.title);
    if (!usedTitles.has(key)) {
      usedTitles.add(key);
      return result;
    }
  }

  const result = fallback ?? fitTitle([pools.core], pools.core);
  usedTitles.add(keywordElonSeoCanonical(result.title));
  return result;
}

export function buildKeywordElonSeoPackage(
  input: KeywordElonSeoPackageInput,
  markets: KeywordElonSeoMarket[],
): KeywordElonSeoPackage {
  const blockedKeys = normalizedBlockedKeys(input);
  const candidateMap = new Map<string, KeywordElonSeoCandidate>();
  for (const row of input.candidates ?? []) {
    const key = candidateKey(row);
    if (key && !candidateMap.has(key)) candidateMap.set(key, row);
  }

  const allowedRows: KeywordElonSeoCandidate[] = [];
  const seenAllowed = new Set<string>();
  for (const rawKey of input.allowedKeys ?? []) {
    const key = keywordElonSeoCanonical(rawKey);
    const row = candidateMap.get(key);
    if (!row || seenAllowed.has(key) || blocked(candidateText(row), blockedKeys)) continue;
    seenAllowed.add(key);
    allowedRows.push(row);
  }

  const search = buildCommonSearchKeywords(input, allowedRows, blockedKeys);
  const generatedFallbackKeywordCount = Math.max(0, search.keywords.length - search.marketDerivedKeywordCount);
  const pools = titlePools(input, allowedRows, blockedKeys);
  const usedTitles = new Set<string>();
  const groupIndexes = new Map<string, number>();
  const mallTitles = markets.map((market) => {
    const groupIndex = groupIndexes.get(market.productGroup) ?? 0;
    groupIndexes.set(market.productGroup, groupIndex + 1);
    const result = buildOneMallTitle(market, groupIndex, pools, usedTitles);
    return {
      productGroup: market.productGroup,
      groupSuffix: market.groupSuffix,
      marketName: market.marketName,
      mallKey: market.mallKey,
      accountIdLabel: market.accountIdLabel,
      title: result.title,
      byteLength: keywordElonSeoUtf8Bytes(result.title),
      usedMaterials: result.usedMaterials,
    };
  });

  const warnings: string[] = [];
  if (generatedFallbackKeywordCount > 0) {
    warnings.push(
      `STEP 4 통과 시장키워드가 ${search.marketDerivedKeywordCount}개여서 ${generatedFallbackKeywordCount}개는 상품 정체성·통과재료 조합으로 보완했습니다.`,
    );
  }
  if (search.keywords.length < KEYWORD_ELON_SEO_SEARCH_LIMIT) {
    warnings.push(
      `공통 검색어가 ${search.keywords.length}/${KEYWORD_ELON_SEO_SEARCH_LIMIT}개입니다. STEP 5 또는 추가 발굴 후 다시 확인하세요.`,
    );
  }
  const uniqueTitleCount = new Set(mallTitles.map((row) => keywordElonSeoCanonical(row.title))).size;
  if (uniqueTitleCount < mallTitles.length) {
    warnings.push(`검증 재료가 좁아 ${mallTitles.length - uniqueTitleCount}개 쇼핑몰 제목이 중복되었습니다.`);
  }

  return {
    status: search.keywords.length === KEYWORD_ELON_SEO_SEARCH_LIMIT ? "ready" : "needs_more_keywords",
    commonSearchKeywords: search.keywords,
    marketDerivedKeywordCount: search.marketDerivedKeywordCount,
    generatedFallbackKeywordCount,
    allowedMaterialCount: allowedRows.length,
    mallTitles,
    uniqueTitleCount,
    warnings,
  };
}
