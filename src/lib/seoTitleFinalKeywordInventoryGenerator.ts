import {
  KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT,
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
} from "./keywordEngineElonLabSeoOutput.ts";
import {
  KEYWORD_ELON_LONG_TITLE_HARD_MIN_BYTES,
  KEYWORD_ELON_LONG_TITLE_IDEAL_MIN_BYTES,
  KEYWORD_ELON_LONG_TITLE_RECOMMENDED_MIN_BYTES,
  KEYWORD_ELON_LONG_TITLE_TARGET_BYTES,
  buildKeywordElonLongTitleExpansionMaterial,
  buildKeywordElonLongTitleFinalMaterial,
  enumerateKeywordElonLongTitleSegments,
  keywordElonLongTitleInternalRedundancyPenalty,
  keywordElonLongTitleLengthPenalty,
  keywordElonLongTitleMaterialPenalty,
  keywordElonLongTitleSegmentCountPenalty,
  type KeywordElonLongTitleMaterial,
  type KeywordElonLongTitlePriorityTier,
} from "./keywordEngineElonLongTitlePriority.ts";
import type {
  KeywordElonTitleExpansionMaterial,
  KeywordElonTitleIntentClass,
} from "./keywordEngineElonTitleExpansion.ts";

const SEO_TITLE_DEFAULT_ROUNDS = 5;
const SEO_TITLE_MAX_ROUNDS = 50;
const SEO_TITLE_GROUP_QUOTAS = {
  도매1: 5,
  도매2: 3,
  도매3: 3,
  도매4: 1,
  소매1: 12,
  소매2: 5,
} as const;

type SeoTitleProductGroup = keyof typeof SEO_TITLE_GROUP_QUOTAS;
const GROUPS = Object.keys(SEO_TITLE_GROUP_QUOTAS) as SeoTitleProductGroup[];

export type FinalKeywordOnlyInventoryCandidate = {
  productGroup: SeoTitleProductGroup;
  title: string;
  titleFingerprint: string;
  semanticFingerprint: string;
  qualityScore: number;
  sourceMaterials: string[];
  metadata: {
    strategy:
      | "long-title-priority-v6"
      | "long-title-priority-v6-final-fallback";
    modelPosition: "first" | "after_lead";
    keywordCount: number;
    materialOrigins: Array<"final_keyword" | "category_expansion">;
    intentClasses: KeywordElonTitleIntentClass[];
    priorityTiers: KeywordElonLongTitlePriorityTier[];
  };
};

export type FinalKeywordOnlyInventoryResult = {
  rounds: number;
  targetCount: number;
  generatedCount: number;
  candidates: FinalKeywordOnlyInventoryCandidate[];
  groupTargets: Record<SeoTitleProductGroup, number>;
  groupGenerated: Record<SeoTitleProductGroup, number>;
  groupShortages: Record<SeoTitleProductGroup, number>;
  materialCount: number;
  expansionMaterialCount: number;
  warnings: string[];
};

type CandidateSeed = {
  title: string;
  fingerprint: string;
  segments: KeywordElonLongTitleMaterial[];
  bytes: number;
  expansionCount: number;
  preferredExpansionCount: number;
  supportingExpansionCount: number;
  adjacentExpansionCount: number;
  intentClasses: KeywordElonTitleIntentClass[];
  materialPenalty: number;
  redundancyPenalty: number;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function uniqueKeywords(values: unknown[]) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const keyword = text(value);
    const key = keywordElonSeoCanonical(keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
  }
  return result;
}

function buildMaterials(
  finalKeywords: string[],
  titleExpansionPool: KeywordElonTitleExpansionMaterial[],
) {
  const finals = uniqueKeywords(finalKeywords);
  const materials: KeywordElonLongTitleMaterial[] = finals.map(
    (keyword, index) =>
      buildKeywordElonLongTitleFinalMaterial({
        keyword,
        key: keywordElonSeoCanonical(keyword),
        sourceOrder: index,
      }),
  );
  const seen = new Set(materials.map((row) => row.key));
  for (let index = 0; index < titleExpansionPool.length; index += 1) {
    const row = titleExpansionPool[index];
    if (row.categoryAligned !== true) continue;
    const keyword = text(row.keyword);
    const key = keywordElonSeoCanonical(keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    materials.push(
      buildKeywordElonLongTitleExpansionMaterial({
        row,
        keyword,
        key,
        sourceOrder: finals.length + index,
      }),
    );
  }
  return { finals, materials };
}

function buildCandidatePool(
  materials: KeywordElonLongTitleMaterial[],
  finalKeys: Set<string>,
) {
  const result: CandidateSeed[] = [];
  const seen = new Set<string>();

  enumerateKeywordElonLongTitleSegments({
    materials,
    finalKeys,
    append: (segments) => {
      if (segments.length < 2) return false;
      if (!segments.some((segment) => finalKeys.has(segment.key))) return false;
      const title = segments
        .map((segment) => segment.keyword)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const fingerprint = keywordElonSeoCanonical(title);
      const bytes = keywordElonSeoUtf8Bytes(title);
      if (
        !fingerprint ||
        seen.has(fingerprint) ||
        bytes < KEYWORD_ELON_LONG_TITLE_HARD_MIN_BYTES ||
        bytes > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT
      ) {
        return false;
      }
      seen.add(fingerprint);
      result.push({
        title,
        fingerprint,
        segments: [...segments],
        bytes,
        expansionCount: segments.filter(
          (segment) => segment.origin === "category_expansion",
        ).length,
        preferredExpansionCount: segments.filter(
          (segment) => segment.priorityTier === "preferred",
        ).length,
        supportingExpansionCount: segments.filter(
          (segment) => segment.priorityTier === "supporting",
        ).length,
        adjacentExpansionCount: segments.filter(
          (segment) => segment.priorityTier === "adjacent",
        ).length,
        intentClasses: [
          ...new Set(segments.map((segment) => segment.intentClass)),
        ],
        materialPenalty: segments.reduce(
          (sum, segment) =>
            sum + keywordElonLongTitleMaterialPenalty(segment),
          0,
        ),
        redundancyPenalty: keywordElonLongTitleInternalRedundancyPenalty(
          segments.map((segment) => segment.key),
        ),
      });
      return true;
    },
  });

  return result.sort(
    (left, right) =>
      scoreCandidate(right) - scoreCandidate(left) ||
      right.preferredExpansionCount - left.preferredExpansionCount ||
      right.supportingExpansionCount - left.supportingExpansionCount ||
      left.adjacentExpansionCount - right.adjacentExpansionCount ||
      Math.abs(KEYWORD_ELON_LONG_TITLE_TARGET_BYTES - left.bytes) -
        Math.abs(KEYWORD_ELON_LONG_TITLE_TARGET_BYTES - right.bytes) ||
      left.fingerprint.localeCompare(right.fingerprint, "ko"),
  );
}

function scoreCandidate(candidate: CandidateSeed) {
  const intentBonus = Math.max(0, candidate.intentClasses.length - 1) * 2;
  const penalty =
    keywordElonLongTitleLengthPenalty(candidate.bytes) +
    keywordElonLongTitleSegmentCountPenalty(candidate.segments.length) +
    candidate.materialPenalty +
    candidate.redundancyPenalty -
    intentBonus;
  return Math.max(
    0,
    Math.min(100, Math.round((100 - penalty) * 1000) / 1000),
  );
}

export function generateFinalKeywordOnlySeoTitleInventory(input: {
  finalKeywords: string[];
  titleExpansionPool?: KeywordElonTitleExpansionMaterial[];
  rounds?: number;
  existingTitleFingerprints?: string[];
}): FinalKeywordOnlyInventoryResult {
  const { finals, materials } = buildMaterials(
    input.finalKeywords,
    input.titleExpansionPool ?? [],
  );
  if (finals.length < 2) {
    throw new Error("상품명 재고를 만들 FINAL 키워드가 2개 이상 필요합니다.");
  }
  const finalKeys = new Set(finals.map(keywordElonSeoCanonical));
  const expansionMaterialCount = materials.filter(
    (row) => row.origin === "category_expansion",
  ).length;

  const rounds = Math.max(
    1,
    Math.min(
      SEO_TITLE_MAX_ROUNDS,
      Math.trunc(Number(input.rounds) || SEO_TITLE_DEFAULT_ROUNDS),
    ),
  );
  const groupTargets = Object.fromEntries(
    GROUPS.map((group) => [group, SEO_TITLE_GROUP_QUOTAS[group] * rounds]),
  ) as Record<SeoTitleProductGroup, number>;
  const targetCount = GROUPS.reduce(
    (sum, group) => sum + groupTargets[group],
    0,
  );
  const existing = new Set(
    (input.existingTitleFingerprints ?? [])
      .map(keywordElonSeoCanonical)
      .filter(Boolean),
  );
  const pool = buildCandidatePool(materials, finalKeys).filter(
    (candidate) => !existing.has(candidate.fingerprint),
  );
  if (pool.length < targetCount) {
    throw new Error(
      `검증 키워드만으로 ${KEYWORD_ELON_LONG_TITLE_HARD_MIN_BYTES}~${KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT}bytes 상품명 재고 ${targetCount}개를 만들 수 없습니다. 사용 가능한 고유 조합 ${pool.length}개`,
    );
  }

  const candidates: FinalKeywordOnlyInventoryCandidate[] = [];
  const selectedSeeds: CandidateSeed[] = [];
  const used = new Set(existing);
  const groupGenerated = Object.fromEntries(
    GROUPS.map((group) => [group, 0]),
  ) as Record<SeoTitleProductGroup, number>;
  const groupShortages = Object.fromEntries(
    GROUPS.map((group) => [group, 0]),
  ) as Record<SeoTitleProductGroup, number>;

  for (let groupIndex = 0; groupIndex < GROUPS.length; groupIndex += 1) {
    const group = GROUPS[groupIndex];
    const target = groupTargets[group];
    let cursor = (groupIndex * 17) % pool.length;
    let attempts = 0;
    while (groupGenerated[group] < target && attempts < pool.length * 2) {
      const seed = pool[cursor % pool.length];
      cursor += 1;
      attempts += 1;
      if (used.has(seed.fingerprint)) continue;
      used.add(seed.fingerprint);
      selectedSeeds.push(seed);
      candidates.push({
        productGroup: group,
        title: seed.title,
        titleFingerprint: seed.fingerprint,
        semanticFingerprint: `${group}:${seed.segments
          .map((segment) => segment.key)
          .join(">")}`,
        qualityScore: scoreCandidate(seed),
        sourceMaterials: seed.segments.map((segment) => segment.keyword),
        metadata: {
          strategy: expansionMaterialCount
            ? "long-title-priority-v6"
            : "long-title-priority-v6-final-fallback",
          modelPosition: groupIndex % 2 === 0 ? "first" : "after_lead",
          keywordCount: seed.segments.length,
          materialOrigins: [
            ...new Set(seed.segments.map((segment) => segment.origin)),
          ],
          intentClasses: seed.intentClasses,
          priorityTiers: [
            ...new Set(seed.segments.map((segment) => segment.priorityTier)),
          ],
        },
      });
      groupGenerated[group] += 1;
    }
    groupShortages[group] = Math.max(0, target - groupGenerated[group]);
  }

  const generatedCount = candidates.length;
  const recommendedLengthCount = selectedSeeds.filter(
    (candidate) =>
      candidate.bytes >= KEYWORD_ELON_LONG_TITLE_RECOMMENDED_MIN_BYTES,
  ).length;
  const idealLengthCount = selectedSeeds.filter(
    (candidate) => candidate.bytes >= KEYWORD_ELON_LONG_TITLE_IDEAL_MIN_BYTES,
  ).length;
  const adjacentExpansionCount = selectedSeeds.filter(
    (candidate) => candidate.adjacentExpansionCount > 0,
  ).length;
  const averageLengthBytes =
    Math.round(
      (selectedSeeds.reduce((sum, candidate) => sum + candidate.bytes, 0) /
        Math.max(1, selectedSeeds.length)) *
        1000,
    ) / 1000;
  const warnings: string[] = [
    expansionMaterialCount
      ? "SEO_TITLE_INVENTORY_SOURCE:LONG_TITLE_PRIORITY_V6"
      : "SEO_TITLE_INVENTORY_SOURCE:LONG_TITLE_PRIORITY_V6_FINAL_FALLBACK",
    `SEO_TITLE_INVENTORY_EXPANSION_MATERIALS:${expansionMaterialCount}`,
    `SEO_TITLE_INVENTORY_LENGTH_HARD_RANGE:${KEYWORD_ELON_LONG_TITLE_HARD_MIN_BYTES}-${KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT}`,
    `SEO_TITLE_INVENTORY_LENGTH_RECOMMENDED:${recommendedLengthCount}/${generatedCount}`,
    `SEO_TITLE_INVENTORY_LENGTH_IDEAL:${idealLengthCount}/${generatedCount}`,
    `SEO_TITLE_INVENTORY_LENGTH_TARGET:${KEYWORD_ELON_LONG_TITLE_TARGET_BYTES}`,
    `SEO_TITLE_INVENTORY_LENGTH_AVERAGE:${averageLengthBytes}`,
    `SEO_TITLE_INVENTORY_ADJACENT_EXPANSION:${adjacentExpansionCount}/${generatedCount}`,
  ];
  for (const group of GROUPS) {
    if (groupShortages[group] > 0) {
      warnings.push(
        `${group} 상품명 재고가 목표보다 ${groupShortages[group]}개 부족합니다.`,
      );
    }
  }
  if (generatedCount !== targetCount) {
    throw new Error(
      `상품명 재고 생성량이 ${generatedCount}/${targetCount}개입니다.`,
    );
  }

  const allowed = new Set(materials.map((row) => row.key));
  for (const candidate of candidates) {
    const bytes = keywordElonSeoUtf8Bytes(candidate.title);
    if (
      bytes < KEYWORD_ELON_LONG_TITLE_HARD_MIN_BYTES ||
      bytes > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT
    ) {
      throw new Error(
        `상품명 재고 길이가 ${KEYWORD_ELON_LONG_TITLE_HARD_MIN_BYTES}~${KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT}bytes 범위를 벗어났습니다.`,
      );
    }
    if (
      candidate.sourceMaterials.some(
        (material) => !allowed.has(keywordElonSeoCanonical(material)),
      )
    ) {
      throw new Error(
        `검증되지 않은 상품명 재고 재료가 감지되었습니다: ${candidate.title}`,
      );
    }
    if (
      !candidate.sourceMaterials.some((material) =>
        finalKeys.has(keywordElonSeoCanonical(material)),
      )
    ) {
      throw new Error(
        `FINAL 키워드가 없는 상품명 재고가 감지되었습니다: ${candidate.title}`,
      );
    }
  }

  return {
    rounds,
    targetCount,
    generatedCount,
    candidates,
    groupTargets,
    groupGenerated,
    groupShortages,
    materialCount: materials.length,
    expansionMaterialCount,
    warnings,
  };
}
