import {
  KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
  KEYWORD_ELON_SEO_NOISE_TERMS,
  KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT,
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
} from "@/lib/keywordEngineElonLabSeoOutput";
import {
  SEO_TITLE_FULL_MARKET_SIZE,
  SEO_TITLE_GROUP_QUOTAS,
  generateSeoTitleInventory,
  type SeoTitleInventoryCandidate,
  type SeoTitleInventoryGenerationInput,
  type SeoTitleInventoryGenerationResult,
  type SeoTitleProductGroup,
} from "@/lib/seoTitleInventoryGenerator";

export type SeoTitleDiversityGrade = "A" | "B" | "C" | "D";

export type GuaranteedSeoTitleInventoryCandidate = SeoTitleInventoryCandidate & {
  metadata: SeoTitleInventoryCandidate["metadata"] & {
    diversityGrade: SeoTitleDiversityGrade;
    generationReason: string;
    fallbackSequence?: number;
  };
};

export type GuaranteedSeoTitleInventoryResult = Omit<
  SeoTitleInventoryGenerationResult,
  "candidates"
> & {
  candidates: GuaranteedSeoTitleInventoryCandidate[];
  forcedFilledCount: number;
  gradeCounts: Record<SeoTitleDiversityGrade, number>;
};

type FallbackMaterial = {
  value: string;
  key: string;
  origin: string;
};

const BLOCKED_KEYS = [
  ...KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
  ...KEYWORD_ELON_SEO_NOISE_TERMS,
].map(keywordElonSeoCanonical).filter(Boolean);

const MARKETPLACE_NAME_PATTERN = /(쿠팡|스마트스토어|네이버|옥션|지마켓|11번가|에이블리|롯데\s*on|롯데온|토스쇼핑|신세계몰|카카오톡\s*스토어|도매꾹|도매매|오너클랜|셀파|투비즈온|카페24|gs\s*shop|인큐텐)/i;

const MODEL_POSITION: Record<SeoTitleProductGroup, "first" | "after_lead"> = {
  도매1: "first",
  도매2: "after_lead",
  도매3: "after_lead",
  도매4: "first",
  소매1: "after_lead",
  소매2: "after_lead",
};

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

function blocked(value: unknown) {
  const normalized = text(value);
  const key = keywordElonSeoCanonical(normalized);
  return (
    !key ||
    MARKETPLACE_NAME_PATTERN.test(normalized) ||
    BLOCKED_KEYS.some((blockedKey) => blockedKey && key.includes(blockedKey))
  );
}

function modelOccurrenceCount(title: string, modelName: string) {
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

function validTitle(title: string, modelName: string) {
  return Boolean(
    title &&
    keywordElonSeoUtf8Bytes(title) <= KEYWORD_ELON_SEO_TITLE_BYTE_LIMIT &&
    modelOccurrenceCount(title, modelName) === 1 &&
    !blocked(title)
  );
}

function stripModelOverlap(value: string, modelName: string) {
  const valueKey = keywordElonSeoCanonical(value);
  const modelKey = keywordElonSeoCanonical(modelName);
  if (!valueKey || !modelKey) return value;
  if (valueKey === modelKey || modelKey.includes(valueKey)) return "";
  if (valueKey.includes(modelKey)) {
    const words = value.split(/\s+/).filter(Boolean).filter((word) => {
      const key = keywordElonSeoCanonical(word);
      return key && !modelKey.includes(key);
    });
    return words.join(" ");
  }
  return value;
}

function buildFallbackMaterials(input: SeoTitleInventoryGenerationInput) {
  const modelKey = keywordElonSeoCanonical(input.modelName);
  const output: FallbackMaterial[] = [];
  const seen = new Set<string>();
  const add = (value: unknown, origin: string) => {
    const normalized = clean(stripModelOverlap(clean(value), input.modelName));
    const key = keywordElonSeoCanonical(normalized);
    if (
      !key ||
      key.length < 2 ||
      key === modelKey ||
      seen.has(key) ||
      blocked(normalized) ||
      keywordElonSeoUtf8Bytes(normalized) > 24
    ) {
      return;
    }
    seen.add(key);
    output.push({ value: normalized, key, origin });
  };

  for (const row of input.searchKeywords ?? []) {
    add(row.keyword, text(row.origin) || "search_keyword");
    for (const material of row.sourceMaterials ?? []) add(material, text(row.origin) || "search_source");
  }
  for (const value of input.extraMaterials ?? []) add(value, "fact_pool");

  const sourcePhrases = [
    ...(input.searchKeywords ?? []).map((row) => row.keyword),
    ...(input.extraMaterials ?? []),
  ];
  for (const phrase of sourcePhrases) {
    const cleaned = clean(phrase);
    if (MARKETPLACE_NAME_PATTERN.test(cleaned)) continue;
    for (const word of cleaned.split(/\s+/).filter(Boolean)) {
      if (keywordElonSeoCanonical(word).length >= 2) add(word, "fact_token");
    }
  }

  // Keep short, high-combination materials first so sparse products still fit under 50 bytes.
  return output
    .sort(
      (left, right) =>
        keywordElonSeoUtf8Bytes(left.value) - keywordElonSeoUtf8Bytes(right.value) ||
        left.value.localeCompare(right.value, "ko"),
    )
    .slice(0, 28);
}

function orderedSequences<T>(values: T[], size: number, visit: (sequence: T[]) => boolean | void) {
  const selected: T[] = [];
  const used = new Set<number>();
  const walk = (): boolean => {
    if (selected.length === size) return visit([...selected]) === true;
    for (let index = 0; index < values.length; index += 1) {
      if (used.has(index)) continue;
      used.add(index);
      selected.push(values[index]);
      if (walk()) return true;
      selected.pop();
      used.delete(index);
    }
    return false;
  };
  walk();
}

function composeFallbackTitle(
  modelName: string,
  materials: FallbackMaterial[],
  position: "first" | "after_lead",
) {
  const values = materials.map((row) => row.value);
  return (
    position === "after_lead" && values.length
      ? [values[0], modelName, ...values.slice(1)]
      : [modelName, ...values]
  ).join(" ").replace(/\s+/g, " ").trim();
}

function gradeQuality(grade: SeoTitleDiversityGrade, materialCount: number) {
  const base = { A: 84, B: 72, C: 61, D: 48 }[grade];
  return Math.max(1, Math.min(100, base + Math.min(6, materialCount * 1.5)));
}

function gradeStrictCandidate(candidate: SeoTitleInventoryCandidate): SeoTitleDiversityGrade {
  if (candidate.sourceMaterials.length >= 2) return "A";
  return "B";
}

function withGrade(
  candidate: SeoTitleInventoryCandidate,
  grade = gradeStrictCandidate(candidate),
): GuaranteedSeoTitleInventoryCandidate {
  return {
    ...candidate,
    metadata: {
      ...candidate.metadata,
      diversityGrade: grade,
      generationReason: grade === "A" ? "semantic_diversity" : "verified_material_diversity",
    },
  };
}

export function generateGuaranteedSeoTitleInventory(
  input: SeoTitleInventoryGenerationInput,
): GuaranteedSeoTitleInventoryResult {
  const rounds = Math.max(1, Math.trunc(Number(input.rounds) || 5));
  let strict: SeoTitleInventoryGenerationResult;
  try {
    strict = generateSeoTitleInventory(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/검증 재료가 없습니다/.test(message)) throw error;
    strict = {
      rounds,
      targetCount: SEO_TITLE_FULL_MARKET_SIZE * rounds,
      generatedCount: 0,
      candidates: [],
      groupTargets: Object.fromEntries(
        (Object.keys(SEO_TITLE_GROUP_QUOTAS) as SeoTitleProductGroup[]).map((group) => [
          group,
          SEO_TITLE_GROUP_QUOTAS[group] * rounds,
        ]),
      ) as Record<SeoTitleProductGroup, number>,
      groupGenerated: Object.fromEntries(
        (Object.keys(SEO_TITLE_GROUP_QUOTAS) as SeoTitleProductGroup[]).map((group) => [group, 0]),
      ) as Record<SeoTitleProductGroup, number>,
      groupShortages: Object.fromEntries(
        (Object.keys(SEO_TITLE_GROUP_QUOTAS) as SeoTitleProductGroup[]).map((group) => [
          group,
          SEO_TITLE_GROUP_QUOTAS[group] * rounds,
        ]),
      ) as Record<SeoTitleProductGroup, number>,
      materialCount: 0,
      warnings: [message],
    };
  }

  const targetCount = SEO_TITLE_FULL_MARKET_SIZE * rounds;
  const candidates: GuaranteedSeoTitleInventoryCandidate[] = strict.candidates.map((row) => withGrade(row));
  const titleFingerprints = new Set(
    [
      ...(input.existingTitleFingerprints ?? []).map(keywordElonSeoCanonical),
      ...candidates.map((row) => row.titleFingerprint),
    ].filter(Boolean),
  );
  const semanticFingerprints = new Set(
    [
      ...(input.existingSemanticFingerprints ?? []).map(text),
      ...candidates.map((row) => row.semanticFingerprint),
    ].filter(Boolean),
  );
  const semanticConcepts = new Set<string>();
  const materials = buildFallbackMaterials(input);
  const groupGenerated = Object.fromEntries(
    (Object.keys(SEO_TITLE_GROUP_QUOTAS) as SeoTitleProductGroup[]).map((group) => [
      group,
      candidates.filter((row) => row.productGroup === group).length,
    ]),
  ) as Record<SeoTitleProductGroup, number>;
  let fallbackSequence = 0;

  const groups = Object.keys(SEO_TITLE_GROUP_QUOTAS) as SeoTitleProductGroup[];
  for (const group of groups) {
    const target = SEO_TITLE_GROUP_QUOTAS[group] * rounds;
    if (groupGenerated[group] >= target) continue;

    for (let size = 1; size <= Math.min(5, materials.length) && groupGenerated[group] < target; size += 1) {
      orderedSequences(materials, size, (sequence) => {
        const positions: Array<"first" | "after_lead"> = [
          MODEL_POSITION[group],
          MODEL_POSITION[group] === "first" ? "after_lead" : "first",
        ];
        for (const position of positions) {
          if (groupGenerated[group] >= target) return true;
          const title = composeFallbackTitle(input.modelName, sequence, position);
          if (!validTitle(title, input.modelName)) continue;
          const titleFingerprint = keywordElonSeoCanonical(title);
          if (!titleFingerprint || titleFingerprints.has(titleFingerprint)) continue;

          const orderedKeys = sequence.map((row) => row.key);
          const conceptKey = [...orderedKeys].sort().join("+");
          const newConcept = !semanticConcepts.has(`${group}:${conceptKey}`);
          const grade: SeoTitleDiversityGrade =
            newConcept
              ? size >= 2
                ? "B"
                : "C"
              : "D";
          const semanticFingerprint = newConcept
            ? `${group}:fallback:${conceptKey || "model"}`
            : `${group}:order:${orderedKeys.join(">")}:${position}`;
          if (semanticFingerprints.has(semanticFingerprint)) continue;

          fallbackSequence += 1;
          titleFingerprints.add(titleFingerprint);
          semanticFingerprints.add(semanticFingerprint);
          semanticConcepts.add(`${group}:${conceptKey}`);
          candidates.push({
            productGroup: group,
            title,
            titleFingerprint,
            semanticFingerprint,
            qualityScore: gradeQuality(grade, sequence.length),
            sourceMaterials: sequence.map((row) => row.value),
            metadata: {
              strategy: `강제 145개 보충 · ${grade}`,
              modelPosition: position,
              keywordCount: sequence.length,
              materialOrigins: [...new Set(sequence.map((row) => row.origin))],
              diversityGrade: grade,
              generationReason:
                grade === "D"
                  ? "verified_word_order_permutation"
                  : grade === "C"
                    ? "single_verified_modifier"
                    : "verified_material_combination",
              fallbackSequence,
            },
          });
          groupGenerated[group] += 1;
        }
        return groupGenerated[group] >= target;
      });
    }
  }

  const groupShortages = Object.fromEntries(
    groups.map((group) => [
      group,
      Math.max(0, SEO_TITLE_GROUP_QUOTAS[group] * rounds - groupGenerated[group]),
    ]),
  ) as Record<SeoTitleProductGroup, number>;
  const remainingShortage = Object.values(groupShortages).reduce((sum, value) => sum + value, 0);
  if (remainingShortage > 0) {
    throw new Error(
      `상품명 재고 ${targetCount}개 강제 생성에 실패했습니다. 검증 단어가 너무 적거나 50bytes 제한에 걸렸습니다. 부족 ${remainingShortage}개`,
    );
  }

  const gradeCounts: Record<SeoTitleDiversityGrade, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const candidate of candidates) gradeCounts[candidate.metadata.diversityGrade] += 1;
  const forcedFilledCount = Math.max(0, candidates.length - strict.candidates.length);
  const warnings = strict.warnings.filter((warning) => !/목표보다|억지 수식어/.test(warning));
  if (forcedFilledCount) warnings.push(`SEO_TITLE_GUARANTEED_FILL:${forcedFilledCount}`);
  if (gradeCounts.D) warnings.push(`SEO_TITLE_ORDER_PERMUTATION_GRADE_D:${gradeCounts.D}`);

  return {
    ...strict,
    rounds,
    targetCount,
    generatedCount: candidates.length,
    candidates,
    groupGenerated,
    groupShortages,
    materialCount: Math.max(strict.materialCount, materials.length),
    warnings,
    forcedFilledCount,
    gradeCounts,
  };
}
