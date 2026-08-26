export const SEO_TITLE_FALLBACK_GROUP_QUOTAS = {
  도매1: 5,
  도매2: 3,
  도매3: 3,
  도매4: 1,
  소매1: 12,
  소매2: 5,
} as const;

export type SeoTitleFallbackProductGroup = keyof typeof SEO_TITLE_FALLBACK_GROUP_QUOTAS;

type KeywordMaterial = {
  keyword: string;
  sourceMaterials?: string[];
};

export type SeoTitleFallbackCandidate = {
  productGroup: SeoTitleFallbackProductGroup;
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

export type SeoTitleInventoryFallbackResult = {
  candidates: SeoTitleFallbackCandidate[];
  appendedCount: number;
  targetCount: number;
  groupCounts: Record<SeoTitleFallbackProductGroup, number>;
  groupShortages: Record<SeoTitleFallbackProductGroup, number>;
  warnings: string[];
};

const GROUPS = Object.keys(SEO_TITLE_FALLBACK_GROUP_QUOTAS) as SeoTitleFallbackProductGroup[];
const UNSUPPORTED_MARKETING_TERMS = [
  "인기",
  "베스트",
  "최고",
  "추천상품",
  "프리미엄",
  "명품",
  "정품보장",
] as const;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function seoTitleFallbackCanonical(value: unknown) {
  return text(value).toLocaleLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).length;
}

function validMaterial(value: string, modelName: string) {
  const key = seoTitleFallbackCanonical(value);
  const modelKey = seoTitleFallbackCanonical(modelName);
  if (!key || key.length < 2 || utf8Bytes(value) > 30) return false;
  if (key === modelKey || modelKey.includes(key)) return false;
  if (/^[a-z]{1,6}[0-9-]+$/i.test(key)) return false;
  return !UNSUPPORTED_MARKETING_TERMS.some((term) => key.includes(seoTitleFallbackCanonical(term)));
}

function cleanMaterial(value: unknown, modelName: string) {
  const normalized = text(value)
    .replace(/[\u3400-\u9fff]+/g, " ")
    .replace(/[()[\]{}<>]/g, " ")
    .replace(/[·•:;,|/\\]+/g, " ")
    .replace(/[_~`^=*#@!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  const withoutModel = text(normalized.replace(modelName, " "));
  return validMaterial(withoutModel, modelName) ? withoutModel : "";
}

function buildMaterials(input: {
  modelName: string;
  searchKeywords: KeywordMaterial[];
  extraMaterials: string[];
  baseCandidates: SeoTitleFallbackCandidate[];
}) {
  const values: string[] = [];
  const seen = new Set<string>();
  const add = (raw: unknown) => {
    const cleaned = cleanMaterial(raw, input.modelName);
    const key = seoTitleFallbackCanonical(cleaned);
    if (!key || seen.has(key)) return;
    seen.add(key);
    values.push(cleaned);
  };

  for (const row of input.searchKeywords) {
    add(row.keyword);
    for (const material of row.sourceMaterials ?? []) add(material);
  }
  for (const value of input.extraMaterials) add(value);
  for (const candidate of input.baseCandidates) {
    for (const material of candidate.sourceMaterials ?? []) add(material);
    add(candidate.title);
  }
  return values.slice(0, 48);
}

function permutations<T>(values: T[]) {
  if (values.length <= 1) return [values];
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += 1) {
    const head = values[index];
    const tail = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const rest of permutations(tail)) output.push([head, ...rest]);
  }
  return output;
}

function combinations<T>(values: T[], size: number) {
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

function titlePatterns(modelName: string, ordered: string[]) {
  const output: string[] = [];
  const add = (parts: string[]) => {
    const value = text(parts.filter(Boolean).join(" "));
    if (value && !output.includes(value)) output.push(value);
  };
  add([modelName, ...ordered]);
  add([...ordered, modelName]);
  if (ordered.length) add([ordered[0], modelName, ...ordered.slice(1)]);
  if (ordered.length >= 2) add([...ordered.slice(0, -1), modelName, ordered.at(-1) ?? ""]);
  return output;
}

function validTitle(title: string, modelName: string) {
  const normalized = text(title);
  if (!normalized || utf8Bytes(normalized) > 50) return false;
  if (normalized.split(modelName).length - 1 !== 1) return false;
  const key = seoTitleFallbackCanonical(normalized);
  return !UNSUPPORTED_MARKETING_TERMS.some((term) => key.includes(seoTitleFallbackCanonical(term)));
}

function groupCounts(
  candidates: SeoTitleFallbackCandidate[],
  rounds: number,
) {
  const counts = Object.fromEntries(GROUPS.map((group) => [group, 0])) as Record<
    SeoTitleFallbackProductGroup,
    number
  >;
  for (const candidate of candidates) counts[candidate.productGroup] += 1;
  const shortages = Object.fromEntries(
    GROUPS.map((group) => [
      group,
      Math.max(0, SEO_TITLE_FALLBACK_GROUP_QUOTAS[group] * rounds - counts[group]),
    ]),
  ) as Record<SeoTitleFallbackProductGroup, number>;
  return { counts, shortages };
}

export function fillSeoTitleInventoryShortages(input: {
  modelName: string;
  searchKeywords: KeywordMaterial[];
  extraMaterials?: string[];
  rounds?: number;
  baseCandidates?: SeoTitleFallbackCandidate[];
  existingTitleFingerprints?: string[];
}): SeoTitleInventoryFallbackResult {
  const rounds = Math.max(1, Math.min(50, Math.floor(input.rounds || 5)));
  const baseCandidates = [...(input.baseCandidates ?? [])];
  const candidates = [...baseCandidates];
  const usedTitles = new Set([
    ...(input.existingTitleFingerprints ?? []),
    ...candidates.map((candidate) => candidate.titleFingerprint),
  ].map(seoTitleFallbackCanonical).filter(Boolean));
  const materials = buildMaterials({
    modelName: input.modelName,
    searchKeywords: input.searchKeywords ?? [],
    extraMaterials: input.extraMaterials ?? [],
    baseCandidates,
  });
  const originalCount = candidates.length;

  const tryAppend = (
    group: SeoTitleFallbackProductGroup,
    title: string,
    sourceMaterials: string[],
    tier: "C" | "D",
  ) => {
    if (!validTitle(title, input.modelName)) return false;
    const titleFingerprint = seoTitleFallbackCanonical(title);
    if (!titleFingerprint || usedTitles.has(titleFingerprint)) return false;
    usedTitles.add(titleFingerprint);
    candidates.push({
      productGroup: group,
      title: text(title),
      titleFingerprint,
      semanticFingerprint: `${group}:fallback:${titleFingerprint}`,
      qualityScore: tier === "C" ? 52 : 42,
      sourceMaterials: [...sourceMaterials],
      metadata: {
        strategy: `fixed145_${tier}_${sourceMaterials.length >= 2 ? "combination" : "order"}`,
        modelPosition: title.startsWith(input.modelName) ? "first" : "after_lead",
        keywordCount: sourceMaterials.length,
        materialOrigins: ["verified_fallback"],
      },
    });
    return true;
  };

  const fillFromSize = (size: number, tier: "C" | "D") => {
    if (materials.length < size) return;
    const combos = combinations(materials, size);
    for (const group of GROUPS) {
      const target = SEO_TITLE_FALLBACK_GROUP_QUOTAS[group] * rounds;
      if (candidates.filter((candidate) => candidate.productGroup === group).length >= target) continue;
      for (const combo of combos) {
        for (const ordered of permutations(combo)) {
          for (const title of titlePatterns(input.modelName, ordered)) {
            tryAppend(group, title, ordered, tier);
            if (candidates.filter((candidate) => candidate.productGroup === group).length >= target) break;
          }
          if (candidates.filter((candidate) => candidate.productGroup === group).length >= target) break;
        }
        if (candidates.filter((candidate) => candidate.productGroup === group).length >= target) break;
      }
    }
  };

  fillFromSize(1, "D");
  fillFromSize(2, "C");
  fillFromSize(3, "C");
  fillFromSize(4, "D");

  const { counts, shortages } = groupCounts(candidates, rounds);
  const shortageTotal = Object.values(shortages).reduce((sum, value) => sum + value, 0);
  const targetCount = GROUPS.reduce(
    (sum, group) => sum + SEO_TITLE_FALLBACK_GROUP_QUOTAS[group] * rounds,
    0,
  );
  const warnings: string[] = [];
  const appendedCount = candidates.length - originalCount;
  if (appendedCount) warnings.push(`SEO_TITLE_FIXED145_FALLBACK:${appendedCount}`);
  if (shortageTotal) warnings.push(`SEO_TITLE_FIXED145_SHORTAGE:${shortageTotal}`);

  return {
    candidates,
    appendedCount,
    targetCount,
    groupCounts: counts,
    groupShortages: shortages,
    warnings,
  };
}
