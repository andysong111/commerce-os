import {
  KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT,
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
} from "./keywordEngineElonLabSeoOutput.ts";
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
const MIN_TITLE_BYTES = 30;
const MAX_COMBINATION_SIZE = 4;
const MAX_CANDIDATE_POOL = 60_000;
const TARGET_TITLE_BYTES = 42;

type InventoryMaterial = {
  keyword: string;
  key: string;
  origin: "final_keyword" | "category_expansion";
  intentClass: KeywordElonTitleIntentClass;
};

export type FinalKeywordOnlyInventoryCandidate = {
  productGroup: SeoTitleProductGroup;
  title: string;
  titleFingerprint: string;
  semanticFingerprint: string;
  qualityScore: number;
  sourceMaterials: string[];
  metadata: {
    strategy:
      | "category-intent-expansion-v5"
      | "final-keywords-only-v5-fallback";
    modelPosition: "first" | "after_lead";
    keywordCount: number;
    materialOrigins: Array<"final_keyword" | "category_expansion">;
    intentClasses: KeywordElonTitleIntentClass[];
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
  segments: InventoryMaterial[];
  bytes: number;
  expansionCount: number;
  intentClasses: KeywordElonTitleIntentClass[];
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
  const materials: InventoryMaterial[] = finals.map((keyword) => ({
    keyword,
    key: keywordElonSeoCanonical(keyword),
    origin: "final_keyword" as const,
    intentClass: "core_synonym" as const,
  }));
  const seen = new Set(materials.map((row) => row.key));
  for (const row of titleExpansionPool) {
    if (row.categoryAligned !== true) continue;
    const keyword = text(row.keyword);
    const key = keywordElonSeoCanonical(keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    materials.push({
      keyword,
      key,
      origin: "category_expansion",
      intentClass: row.intentClass,
    });
  }
  return { finals, materials };
}

function buildCandidatePool(
  materials: InventoryMaterial[],
  finalKeys: Set<string>,
) {
  const result: CandidateSeed[] = [];
  const seen = new Set<string>();

  const append = (segments: InventoryMaterial[]) => {
    if (segments.length < 2) return;
    if (!segments.some((segment) => finalKeys.has(segment.key))) return;
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
      bytes < MIN_TITLE_BYTES ||
      bytes > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT
    ) {
      return;
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
      intentClasses: [...new Set(segments.map((segment) => segment.intentClass))],
    });
  };

  const maxSize = Math.min(MAX_COMBINATION_SIZE, materials.length);
  for (let size = 2; size <= maxSize; size += 1) {
    const selected: InventoryMaterial[] = [];
    const used = new Set<number>();
    const walk = () => {
      if (result.length >= MAX_CANDIDATE_POOL) return;
      if (selected.length === size) {
        append(selected);
        return;
      }
      for (let index = 0; index < materials.length; index += 1) {
        if (used.has(index)) continue;
        used.add(index);
        selected.push(materials[index]);
        walk();
        selected.pop();
        used.delete(index);
        if (result.length >= MAX_CANDIDATE_POOL) return;
      }
    };
    walk();
  }

  const expansionAvailable = materials.some(
    (row) => row.origin === "category_expansion",
  );
  return result.sort(
    (left, right) =>
      (expansionAvailable
        ? Number(right.expansionCount > 0) - Number(left.expansionCount > 0)
        : 0) ||
      right.intentClasses.length - left.intentClasses.length ||
      Math.abs(TARGET_TITLE_BYTES - left.bytes) -
        Math.abs(TARGET_TITLE_BYTES - right.bytes) ||
      Math.abs(3 - left.segments.length) - Math.abs(3 - right.segments.length) ||
      right.expansionCount - left.expansionCount ||
      left.fingerprint.localeCompare(right.fingerprint, "ko"),
  );
}

function scoreCandidate(candidate: CandidateSeed) {
  const distance = Math.abs(TARGET_TITLE_BYTES - candidate.bytes);
  const segmentPenalty = Math.abs(3 - candidate.segments.length) * 1.5;
  const intentBonus = Math.max(0, candidate.intentClasses.length - 1) * 2;
  const expansionBonus = candidate.expansionCount > 0 ? 2 : 0;
  return Math.max(
    50,
    Math.round(
      (100 - distance * 0.8 - segmentPenalty + intentBonus + expansionBonus) *
        1000,
    ) / 1000,
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
      `검증 키워드만으로 ${MIN_TITLE_BYTES}~${KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT}bytes 상품명 재고 ${targetCount}개를 만들 수 없습니다. 사용 가능한 고유 조합 ${pool.length}개`,
    );
  }

  const candidates: FinalKeywordOnlyInventoryCandidate[] = [];
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
            ? "category-intent-expansion-v5"
            : "final-keywords-only-v5-fallback",
          modelPosition: groupIndex % 2 === 0 ? "first" : "after_lead",
          keywordCount: seed.segments.length,
          materialOrigins: [
            ...new Set(seed.segments.map((segment) => segment.origin)),
          ],
          intentClasses: seed.intentClasses,
        },
      });
      groupGenerated[group] += 1;
    }
    groupShortages[group] = Math.max(0, target - groupGenerated[group]);
  }

  const generatedCount = candidates.length;
  const warnings: string[] = [
    expansionMaterialCount
      ? "SEO_TITLE_INVENTORY_SOURCE:CATEGORY_INTENT_EXPANSION_V5"
      : "SEO_TITLE_INVENTORY_SOURCE:FINAL_KEYWORDS_ONLY_V5_FALLBACK",
    `SEO_TITLE_INVENTORY_EXPANSION_MATERIALS:${expansionMaterialCount}`,
    `SEO_TITLE_INVENTORY_LENGTH_BYTES:${MIN_TITLE_BYTES}-${KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT}`,
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
    if (bytes < MIN_TITLE_BYTES || bytes > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT) {
      throw new Error(
        `상품명 재고 길이가 ${MIN_TITLE_BYTES}~${KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT}bytes 범위를 벗어났습니다.`,
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
      throw new Error(`FINAL 키워드가 없는 상품명 재고가 감지되었습니다: ${candidate.title}`);
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
