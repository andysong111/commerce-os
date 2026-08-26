import {
  KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
  KEYWORD_ELON_SEO_NOISE_TERMS,
  KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT,
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
  type KeywordElonSeoIdentity,
  type KeywordElonSeoSearchKeyword,
} from "./keywordEngineElonLabSeoOutput.ts";

type MallTitleRow = {
  title: string;
  productGroup: string;
  modelPosition?: "first" | "after_lead";
  usedMaterials?: string[];
  keywordMaterials?: string[];
  titleKeywordSegments?: string[];
};

export type KeywordElonMallTitleDiversityResult<T extends MallTitleRow> = {
  rows: T[];
  adjustedCount: number;
  uniqueTitleCount: number;
  nearDuplicateCount: number;
  warnings: string[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function cleanMaterial(value: unknown) {
  return text(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[\u3400-\u9fff]+/g, " ")
    .replace(/[·•:;,|/\\]+/g, " ")
    .replace(/[_~`^=*#@!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueMaterials(values: unknown[], limit = 80) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = cleanMaterial(value);
    const key = keywordElonSeoCanonical(cleaned);
    if (!key || key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= limit) break;
  }
  return result;
}

function groundedMaterials(input: {
  identity: KeywordElonSeoIdentity;
  searchKeywords: KeywordElonSeoSearchKeyword[];
  blockedTerms?: string[];
  modelName: string;
}) {
  const identity = input.identity ?? {};
  const blockedKeys = uniqueMaterials([
    ...KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
    ...KEYWORD_ELON_SEO_NOISE_TERMS,
    ...(input.blockedTerms ?? []),
  ]).map(keywordElonSeoCanonical);
  const modelKey = keywordElonSeoCanonical(input.modelName);
  const candidates = uniqueMaterials([
    ...input.searchKeywords.flatMap((row) => [row.keyword, ...(row.sourceMaterials ?? [])]),
    ...(identity.primarySeeds ?? []),
    ...(identity.conditionalSeeds ?? []),
    ...(identity.functionModifiers ?? []),
    ...(identity.designShapeModifiers ?? []),
    ...(identity.specAttributes ?? []),
    identity.koreanProductIdentity,
    identity.identityAnchor,
    identity.coreProduct,
  ]);

  return candidates.filter((value) => {
    const key = keywordElonSeoCanonical(value);
    if (!key || key === modelKey || modelKey.includes(key)) return false;
    return !blockedKeys.some((blocked) => blocked && key.includes(blocked));
  });
}

function modelOccurrenceCount(title: string, modelName: string) {
  if (!modelName) return 0;
  return title.split(modelName).length - 1;
}

function validTitle(title: string, modelName: string) {
  const cleaned = text(title);
  return Boolean(
    cleaned
    && keywordElonSeoUtf8Bytes(cleaned) <= KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT
    && modelOccurrenceCount(cleaned, modelName) === 1,
  );
}

function remainderKey(title: string, modelName: string) {
  const titleKey = keywordElonSeoCanonical(title);
  const modelKey = keywordElonSeoCanonical(modelName);
  if (!titleKey) return "";
  if (!modelKey) return titleKey;
  return titleKey.replace(modelKey, "");
}

function bigrams(value: string) {
  const key = value.trim();
  const result = new Set<string>();
  if (!key) return result;
  if (key.length === 1) {
    result.add(key);
    return result;
  }
  for (let index = 0; index < key.length - 1; index += 1) {
    result.add(key.slice(index, index + 2));
  }
  return result;
}

function similarity(left: string, right: string) {
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftSet = bigrams(left);
  const rightSet = bigrams(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (!union.size) return 0;
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) intersection += 1;
  }
  return intersection / union.size;
}

function isNearDuplicate(title: string, existing: string[], modelName: string) {
  const remainder = remainderKey(title, modelName);
  if (!remainder) return existing.some((row) => remainderKey(row, modelName) === remainder);
  return existing.some((row) => {
    const other = remainderKey(row, modelName);
    return other === remainder || similarity(remainder, other) >= 0.82;
  });
}

function titleRemainder(title: string, modelName: string) {
  if (!modelName || !title.includes(modelName)) return "";
  return text(title.replace(modelName, " "));
}

function candidateTitles(input: {
  baseTitle: string;
  modelName: string;
  materials: string[];
  modelPosition?: "first" | "after_lead";
}) {
  const output: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const candidate = text(value);
    const key = keywordElonSeoCanonical(candidate);
    if (!key || seen.has(key) || !validTitle(candidate, input.modelName)) return;
    seen.add(key);
    output.push(candidate);
  };

  const remainder = titleRemainder(input.baseTitle, input.modelName);
  if (remainder) {
    add(`${input.modelName} ${remainder}`);
    add(`${remainder} ${input.modelName}`);
  }

  const materialPool = input.materials.slice(0, 24);
  for (const material of materialPool) {
    const materialKey = keywordElonSeoCanonical(material);
    const baseKey = keywordElonSeoCanonical(input.baseTitle);
    if (!materialKey || baseKey.includes(materialKey)) continue;
    add(`${input.baseTitle} ${material}`);
    add(`${material} ${input.baseTitle}`);
    add(`${input.modelName} ${material}`);
    add(`${material} ${input.modelName}`);
    if (remainder) {
      if (input.modelPosition === "after_lead") {
        add(`${material} ${input.modelName} ${remainder}`);
      } else {
        add(`${input.modelName} ${material} ${remainder}`);
      }
    }
  }

  for (let left = 0; left < Math.min(16, materialPool.length); left += 1) {
    for (let right = left + 1; right < Math.min(16, materialPool.length); right += 1) {
      const first = materialPool[left];
      const second = materialPool[right];
      if (input.modelPosition === "after_lead") {
        add(`${first} ${input.modelName} ${second}`);
        add(`${second} ${input.modelName} ${first}`);
      } else {
        add(`${input.modelName} ${first} ${second}`);
        add(`${input.modelName} ${second} ${first}`);
      }
    }
  }
  return output;
}

function countNearDuplicates(titles: string[], modelName: string) {
  let count = 0;
  const accepted: string[] = [];
  for (const title of titles) {
    if (isNearDuplicate(title, accepted, modelName)) count += 1;
    accepted.push(title);
  }
  return count;
}

export function diversifyKeywordElonMallTitles<T extends MallTitleRow>(input: {
  rows: T[];
  modelName: string;
  identity: KeywordElonSeoIdentity;
  searchKeywords: KeywordElonSeoSearchKeyword[];
  blockedTerms?: string[];
}): KeywordElonMallTitleDiversityResult<T> {
  const materials = groundedMaterials({
    identity: input.identity,
    searchKeywords: input.searchKeywords,
    blockedTerms: input.blockedTerms,
    modelName: input.modelName,
  });
  const usedTitles: string[] = [];
  const usedKeys = new Set<string>();
  let adjustedCount = 0;

  const rows = input.rows.map((row) => {
    const baseTitle = text(row.title);
    const baseKey = keywordElonSeoCanonical(baseTitle);
    const baseAcceptable = Boolean(
      baseKey
      && !usedKeys.has(baseKey)
      && !isNearDuplicate(baseTitle, usedTitles, input.modelName),
    );

    let selected = baseTitle;
    let appliedMaterial = "";
    if (!baseAcceptable) {
      const candidates = candidateTitles({
        baseTitle,
        modelName: input.modelName,
        materials,
        modelPosition: row.modelPosition,
      });
      selected = candidates.find((candidate) => {
        const key = keywordElonSeoCanonical(candidate);
        return !usedKeys.has(key) && !isNearDuplicate(candidate, usedTitles, input.modelName);
      }) ?? candidates.find((candidate) => !usedKeys.has(keywordElonSeoCanonical(candidate))) ?? baseTitle;

      if (selected !== baseTitle) {
        adjustedCount += 1;
        const selectedKey = keywordElonSeoCanonical(selected);
        appliedMaterial = materials.find((material) => {
          const key = keywordElonSeoCanonical(material);
          return key && selectedKey.includes(key) && !baseKey.includes(key);
        }) ?? "";
      }
    }

    usedTitles.push(selected);
    usedKeys.add(keywordElonSeoCanonical(selected));
    if (!appliedMaterial) return { ...row, title: selected };
    return {
      ...row,
      title: selected,
      usedMaterials: [...new Set([...(row.usedMaterials ?? []), appliedMaterial])],
      keywordMaterials: [...new Set([...(row.keywordMaterials ?? []), appliedMaterial])],
      titleKeywordSegments: [...new Set([...(row.titleKeywordSegments ?? []), appliedMaterial])],
    };
  });

  const titles = rows.map((row) => row.title);
  const uniqueTitleCount = new Set(titles.map(keywordElonSeoCanonical).filter(Boolean)).size;
  const nearDuplicateCount = countNearDuplicates(titles, input.modelName);
  const warnings: string[] = [];
  if (adjustedCount) warnings.push(`SEO_MALL_TITLE_DIVERSITY_ADJUSTED:${adjustedCount}`);
  if (uniqueTitleCount < rows.length) {
    warnings.push(`SEO_MALL_TITLE_EXACT_DUPLICATES_REMAIN:${rows.length - uniqueTitleCount}`);
  }
  if (nearDuplicateCount) warnings.push(`SEO_MALL_TITLE_NEAR_DUPLICATES_REMAIN:${nearDuplicateCount}`);

  return { rows, adjustedCount, uniqueTitleCount, nearDuplicateCount, warnings };
}
