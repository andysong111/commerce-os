import type {
  KeywordElonTitleExpansionMaterial,
  KeywordElonTitleIntentClass,
} from "./keywordEngineElonTitleExpansion.ts";

export const KEYWORD_ELON_LONG_TITLE_HARD_MIN_BYTES = 30;
export const KEYWORD_ELON_LONG_TITLE_RECOMMENDED_MIN_BYTES = 40;
export const KEYWORD_ELON_LONG_TITLE_IDEAL_MIN_BYTES = 44;
export const KEYWORD_ELON_LONG_TITLE_TARGET_BYTES = 48;
export const KEYWORD_ELON_LONG_TITLE_MAX_PARTNERS_PER_FINAL = 20;
export const KEYWORD_ELON_LONG_TITLE_MAX_CANDIDATES = 60_000;

export type KeywordElonLongTitlePriorityTier =
  | "final"
  | "preferred"
  | "supporting"
  | "adjacent";

export type KeywordElonLongTitleMaterial = {
  keyword: string;
  key: string;
  origin: "final_keyword" | "category_expansion";
  intentClass: KeywordElonTitleIntentClass;
  sourceOrder: number;
  expansionScore: number;
  relevance: number;
  categoryMatch: number;
  qualityScore: number;
  competitionOpportunity: number;
  priorityTier: KeywordElonLongTitlePriorityTier;
};

const INTENT_DISTANCE_PENALTY: Record<KeywordElonTitleIntentClass, number> = {
  core_synonym: 0,
  form: 1,
  function: 2,
  use: 3.5,
  category_tail: 5,
  context: 7,
  other: 9,
};

const TIER_PENALTY: Record<KeywordElonLongTitlePriorityTier, number> = {
  final: 0,
  preferred: 1,
  supporting: 5,
  adjacent: 13,
};

function clamp100(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, numeric));
}

function rotate<T>(values: T[], offset: number) {
  if (!values.length) return values;
  const normalized = ((offset % values.length) + values.length) % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}

export function classifyKeywordElonLongTitleExpansion(
  row: KeywordElonTitleExpansionMaterial,
): Exclude<KeywordElonLongTitlePriorityTier, "final"> {
  const expansionScore = clamp100(row.expansionScore);
  const relevance = clamp100(row.relevance);
  const categoryMatch = clamp100(row.categoryMatch);
  const closeIntent = ["core_synonym", "form", "function"].includes(
    row.intentClass,
  );
  const supportingIntent = ["use", "category_tail"].includes(row.intentClass);

  if (
    closeIntent &&
    expansionScore >= 76 &&
    relevance >= 90 &&
    categoryMatch >= 88
  ) {
    return "preferred";
  }
  if (
    (closeIntent && expansionScore >= 70 && relevance >= 87) ||
    (supportingIntent &&
      expansionScore >= 78 &&
      relevance >= 90 &&
      categoryMatch >= 88)
  ) {
    return "supporting";
  }
  return "adjacent";
}

export function buildKeywordElonLongTitleFinalMaterial(input: {
  keyword: string;
  key: string;
  sourceOrder: number;
}): KeywordElonLongTitleMaterial {
  return {
    keyword: input.keyword,
    key: input.key,
    origin: "final_keyword",
    intentClass: "core_synonym",
    sourceOrder: input.sourceOrder,
    expansionScore: 100,
    relevance: 100,
    categoryMatch: 100,
    qualityScore: 100,
    competitionOpportunity: 100,
    priorityTier: "final",
  };
}

export function buildKeywordElonLongTitleExpansionMaterial(input: {
  row: KeywordElonTitleExpansionMaterial;
  keyword: string;
  key: string;
  sourceOrder: number;
}): KeywordElonLongTitleMaterial {
  return {
    keyword: input.keyword,
    key: input.key,
    origin: "category_expansion",
    intentClass: input.row.intentClass,
    sourceOrder: input.sourceOrder,
    expansionScore: clamp100(input.row.expansionScore),
    relevance: clamp100(input.row.relevance),
    categoryMatch: clamp100(input.row.categoryMatch),
    qualityScore: clamp100(input.row.qualityScore),
    competitionOpportunity: clamp100(input.row.competitionOpportunity),
    priorityTier: classifyKeywordElonLongTitleExpansion(input.row),
  };
}

export function keywordElonLongTitleLengthPenalty(byteLength: number) {
  if (byteLength >= KEYWORD_ELON_LONG_TITLE_IDEAL_MIN_BYTES) {
    return Math.abs(KEYWORD_ELON_LONG_TITLE_TARGET_BYTES - byteLength) * 0.75;
  }
  if (byteLength >= KEYWORD_ELON_LONG_TITLE_RECOMMENDED_MIN_BYTES) {
    return (
      10 +
      (KEYWORD_ELON_LONG_TITLE_IDEAL_MIN_BYTES - byteLength) * 4
    );
  }
  if (byteLength >= 36) {
    return (
      30 +
      (KEYWORD_ELON_LONG_TITLE_RECOMMENDED_MIN_BYTES - byteLength) * 6
    );
  }
  return 58 + (36 - byteLength) * 8;
}

export function keywordElonLongTitleMaterialPenalty(
  material: KeywordElonLongTitleMaterial,
) {
  if (material.origin === "final_keyword") return 0;
  const evidencePenalty =
    Math.max(0, 82 - material.expansionScore) * 0.18 +
    Math.max(0, 92 - material.relevance) * 0.2 +
    Math.max(0, 90 - material.categoryMatch) * 0.15 +
    Math.max(0, 75 - material.qualityScore) * 0.08;
  return (
    TIER_PENALTY[material.priorityTier] +
    INTENT_DISTANCE_PENALTY[material.intentClass] +
    evidencePenalty
  );
}

export function keywordElonLongTitleSegmentCountPenalty(segmentCount: number) {
  if (segmentCount === 4) return 0;
  if (segmentCount === 3) return 1;
  if (segmentCount === 2) return 8;
  return 12;
}

export function keywordElonLongTitleInternalRedundancyPenalty(
  materialKeys: string[],
) {
  let penalty = 0;
  for (let index = 0; index < materialKeys.length; index += 1) {
    for (let next = index + 1; next < materialKeys.length; next += 1) {
      const left = materialKeys[index];
      const right = materialKeys[next];
      if (!left || !right) continue;
      if (left.includes(right) || right.includes(left)) penalty += 2.5;
    }
  }
  return penalty;
}

function priorityRank(material: KeywordElonLongTitleMaterial) {
  if (material.priorityTier === "final") return 0;
  if (material.priorityTier === "preferred") return 0;
  if (material.priorityTier === "supporting") return 1;
  return 2;
}

function comparePartners(
  left: KeywordElonLongTitleMaterial,
  right: KeywordElonLongTitleMaterial,
) {
  return (
    priorityRank(left) - priorityRank(right) ||
    keywordElonLongTitleMaterialPenalty(left) -
      keywordElonLongTitleMaterialPenalty(right) ||
    right.expansionScore - left.expansionScore ||
    right.relevance - left.relevance ||
    left.sourceOrder - right.sourceOrder ||
    left.key.localeCompare(right.key, "ko")
  );
}

export function enumerateKeywordElonLongTitleSegments<T extends KeywordElonLongTitleMaterial>(
  input: {
    materials: T[];
    finalKeys: Set<string>;
    append: (segments: T[]) => boolean;
    maxPartnersPerFinal?: number;
    maxCandidates?: number;
  },
) {
  const finalMaterials = input.materials.filter((material) =>
    input.finalKeys.has(material.key),
  );
  const maxPartners = Math.max(
    2,
    Math.min(
      KEYWORD_ELON_LONG_TITLE_MAX_PARTNERS_PER_FINAL,
      Math.floor(
        Number(input.maxPartnersPerFinal) ||
          KEYWORD_ELON_LONG_TITLE_MAX_PARTNERS_PER_FINAL,
      ),
    ),
  );
  const maxCandidates = Math.max(
    1,
    Math.min(
      KEYWORD_ELON_LONG_TITLE_MAX_CANDIDATES,
      Math.floor(
        Number(input.maxCandidates) || KEYWORD_ELON_LONG_TITLE_MAX_CANDIDATES,
      ),
    ),
  );
  let acceptedCount = 0;

  const emit = (segments: T[]) => {
    if (acceptedCount >= maxCandidates) return false;
    if (input.append(segments)) acceptedCount += 1;
    return acceptedCount < maxCandidates;
  };

  for (let anchorIndex = 0; anchorIndex < finalMaterials.length; anchorIndex += 1) {
    if (acceptedCount >= maxCandidates) break;
    const anchor = finalMaterials[anchorIndex];
    const rankedPartners = input.materials
      .filter((material) => material.key !== anchor.key)
      .sort(comparePartners)
      .slice(0, maxPartners);
    const partners = rotate(
      rankedPartners,
      rankedPartners.length ? anchorIndex % rankedPartners.length : 0,
    );

    for (let first = 0; first < partners.length; first += 1) {
      for (let second = first + 1; second < partners.length; second += 1) {
        for (let third = second + 1; third < partners.length; third += 1) {
          const a = partners[first];
          const b = partners[second];
          const c = partners[third];
          for (const order of [
            [anchor, a, b, c],
            [a, anchor, b, c],
            [a, b, anchor, c],
            [a, b, c, anchor],
          ] as T[][]) {
            if (!emit(order)) return acceptedCount;
          }
        }
      }
    }

    for (let first = 0; first < partners.length; first += 1) {
      for (let second = first + 1; second < partners.length; second += 1) {
        const a = partners[first];
        const b = partners[second];
        for (const order of [
          [anchor, a, b],
          [a, anchor, b],
          [a, b, anchor],
        ] as T[][]) {
          if (!emit(order)) return acceptedCount;
        }
      }
    }

    for (const partner of partners) {
      if (!emit([anchor, partner])) return acceptedCount;
      if (!emit([partner, anchor])) return acceptedCount;
    }
  }

  return acceptedCount;
}
