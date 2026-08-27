import {
  KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT,
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
} from "@/lib/keywordEngineElonLabSeoOutput";
import {
  SEO_TITLE_DEFAULT_ROUNDS,
  SEO_TITLE_GROUP_QUOTAS,
  SEO_TITLE_MAX_ROUNDS,
  type SeoTitleProductGroup,
} from "@/lib/seoTitleInventoryGenerator";

const GROUPS = Object.keys(SEO_TITLE_GROUP_QUOTAS) as SeoTitleProductGroup[];
const MAX_COMBINATION_SIZE = 5;
const MAX_CANDIDATE_POOL = 60_000;
const TARGET_TITLE_BYTES = 36;

export type FinalKeywordOnlyInventoryCandidate = {
  productGroup: SeoTitleProductGroup;
  title: string;
  titleFingerprint: string;
  semanticFingerprint: string;
  qualityScore: number;
  sourceMaterials: string[];
  metadata: {
    strategy: "final-keywords-only-v3";
    modelPosition: "first" | "after_lead";
    keywordCount: number;
    materialOrigins: ["final_keyword"];
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
  warnings: string[];
};

type CandidateSeed = {
  title: string;
  fingerprint: string;
  segments: string[];
  bytes: number;
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

function buildCandidatePool(keywords: string[]) {
  const result: CandidateSeed[] = [];
  const seen = new Set<string>();

  const append = (segments: string[]) => {
    const title = segments.join(" ").replace(/\s+/g, " ").trim();
    const fingerprint = keywordElonSeoCanonical(title);
    const bytes = keywordElonSeoUtf8Bytes(title);
    if (
      !fingerprint ||
      seen.has(fingerprint) ||
      bytes > KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT
    ) {
      return;
    }
    seen.add(fingerprint);
    result.push({ title, fingerprint, segments: [...segments], bytes });
  };

  const maxSize = Math.min(MAX_COMBINATION_SIZE, keywords.length);
  for (let size = 2; size <= maxSize; size += 1) {
    const selected: string[] = [];
    const used = new Set<number>();
    const walk = () => {
      if (result.length >= MAX_CANDIDATE_POOL) return;
      if (selected.length === size) {
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
        if (result.length >= MAX_CANDIDATE_POOL) return;
      }
    };
    walk();
  }
  for (const keyword of keywords) append([keyword]);

  return result.sort(
    (left, right) =>
      Math.abs(TARGET_TITLE_BYTES - left.bytes) -
        Math.abs(TARGET_TITLE_BYTES - right.bytes) ||
      right.segments.length - left.segments.length ||
      left.fingerprint.localeCompare(right.fingerprint, "ko"),
  );
}

function scoreCandidate(candidate: CandidateSeed) {
  const distance = Math.abs(TARGET_TITLE_BYTES - candidate.bytes);
  return Math.max(50, Math.round((100 - distance * 0.8) * 1000) / 1000);
}

export function generateFinalKeywordOnlySeoTitleInventory(input: {
  finalKeywords: string[];
  rounds?: number;
  existingTitleFingerprints?: string[];
}): FinalKeywordOnlyInventoryResult {
  const keywords = uniqueKeywords(input.finalKeywords);
  if (keywords.length < 2) {
    throw new Error("상품명 재고를 만들 FINAL 키워드가 2개 이상 필요합니다.");
  }

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
  const targetCount = GROUPS.reduce((sum, group) => sum + groupTargets[group], 0);
  const existing = new Set(
    (input.existingTitleFingerprints ?? [])
      .map(keywordElonSeoCanonical)
      .filter(Boolean),
  );
  const pool = buildCandidatePool(keywords).filter(
    (candidate) => !existing.has(candidate.fingerprint),
  );
  if (pool.length < targetCount) {
    throw new Error(
      `FINAL 키워드만으로 상품명 재고 ${targetCount}개를 만들 수 없습니다. 사용 가능한 고유 조합 ${pool.length}개`,
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
          .map(keywordElonSeoCanonical)
          .join(">")}`,
        qualityScore: scoreCandidate(seed),
        sourceMaterials: [...seed.segments],
        metadata: {
          strategy: "final-keywords-only-v3",
          modelPosition: groupIndex % 2 === 0 ? "first" : "after_lead",
          keywordCount: seed.segments.length,
          materialOrigins: ["final_keyword"],
        },
      });
      groupGenerated[group] += 1;
    }
    groupShortages[group] = Math.max(0, target - groupGenerated[group]);
  }

  const generatedCount = candidates.length;
  const warnings: string[] = [
    "SEO_TITLE_INVENTORY_SOURCE:FINAL_KEYWORDS_ONLY_V3",
  ];
  for (const group of GROUPS) {
    if (groupShortages[group] > 0) {
      warnings.push(`${group} 상품명 재고가 목표보다 ${groupShortages[group]}개 부족합니다.`);
    }
  }
  if (generatedCount !== targetCount) {
    throw new Error(
      `FINAL 키워드 전용 상품명 재고 생성량이 ${generatedCount}/${targetCount}개입니다.`,
    );
  }

  const allowed = new Set(keywords.map(keywordElonSeoCanonical));
  for (const candidate of candidates) {
    if (
      candidate.sourceMaterials.some(
        (material) => !allowed.has(keywordElonSeoCanonical(material)),
      )
    ) {
      throw new Error(`FINAL 키워드 외 상품명 재고 재료가 감지되었습니다: ${candidate.title}`);
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
    materialCount: keywords.length,
    warnings,
  };
}
