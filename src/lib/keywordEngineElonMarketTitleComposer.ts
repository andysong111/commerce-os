import type {
  KeywordElonFact,
  KeywordElonFactKind,
} from "./keywordEngineElonFactPool.ts";

export type KeywordElonMarketProfile =
  | "b2b"
  | "naver"
  | "coupang"
  | "ably"
  | "generic_retail";

type MarketTitleRow = {
  title: string;
  productGroup: string;
  marketName?: string;
  accountIdLabel?: string;
  modelPosition?: "first" | "after_lead";
};

const PROFILE_PRIORITIES: Record<KeywordElonMarketProfile, KeywordElonFactKind[]> = {
  b2b: ["core", "spec", "function", "option", "keyword", "category", "use_context", "shape", "identity"],
  naver: ["keyword", "core", "function", "use_context", "spec", "shape", "option", "category", "identity"],
  coupang: ["core", "keyword", "spec", "option", "function", "identity", "use_context", "shape", "category"],
  ably: ["use_context", "shape", "keyword", "option", "function", "core", "identity", "spec", "category"],
  generic_retail: ["keyword", "function", "core", "spec", "use_context", "shape", "option", "identity", "category"],
};

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

function canonical(value: unknown) {
  return text(value).toLocaleLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).length;
}

function hash(value: string) {
  let output = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    output ^= value.charCodeAt(index);
    output = Math.imul(output, 16777619);
  }
  return output >>> 0;
}

export function resolveKeywordElonMarketProfile(
  marketName: string,
  productGroup = "",
): KeywordElonMarketProfile {
  const market = text(marketName);
  if (market === "스마트스토어") return "naver";
  if (market === "쿠팡") return "coupang";
  if (market === "에이블리") return "ably";
  if (["도매꾹", "도매매", "오너클랜", "셀파", "투비즈온"].includes(market)) {
    return "b2b";
  }
  if (text(productGroup).startsWith("도매")) return "b2b";
  return "generic_retail";
}

function rankedFacts(
  facts: KeywordElonFact[],
  profile: KeywordElonMarketProfile,
  modelName: string,
  seed: string,
) {
  const priority = PROFILE_PRIORITIES[profile];
  const modelKey = canonical(modelName);
  const seen = new Set<string>();
  const rows = facts
    .filter((fact) => fact.titleEligible)
    .filter((fact) => {
      const key = canonical(fact.value);
      if (!key || key === modelKey || modelKey.includes(key) || key.includes(modelKey)) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      const kind = priority.indexOf(left.kind) - priority.indexOf(right.kind);
      if (kind !== 0) return kind;
      if (left.confidence !== right.confidence) return left.confidence === "A" ? -1 : 1;
      return left.value.localeCompare(right.value, "ko");
    });
  if (rows.length <= 1) return rows;
  const offset = hash(seed) % rows.length;
  return [...rows.slice(offset), ...rows.slice(0, offset)];
}

function validTitle(title: string, modelName: string) {
  const value = text(title);
  if (!value || utf8Bytes(value) > 50) return false;
  if (value.split(modelName).length - 1 !== 1) return false;
  const key = canonical(value);
  return !UNSUPPORTED_MARKETING_TERMS.some((term) => key.includes(canonical(term)));
}

function candidatesForProfile(
  profile: KeywordElonMarketProfile,
  modelName: string,
  materials: string[],
) {
  const [first = "", second = "", third = ""] = materials;
  const rows: string[] = [];
  const add = (...segments: string[]) => {
    const value = text(segments.filter(Boolean).join(" "));
    if (value && !rows.includes(value)) rows.push(value);
  };

  if (profile === "b2b") {
    add(modelName, first, second);
    add(modelName, second, first);
    add(first, modelName, second);
    add(modelName, first);
    add(second, modelName);
  } else if (profile === "naver") {
    add(first, modelName, second);
    add(modelName, first, second);
    add(second, modelName, first);
    add(first, modelName, third);
    add(modelName, first);
  } else if (profile === "coupang") {
    add(modelName, first);
    add(modelName, second);
    add(first, modelName);
    add(modelName, first, second);
    add(second, modelName);
  } else if (profile === "ably") {
    add(first, modelName, second);
    add(second, modelName, first);
    add(first, modelName, third);
    add(modelName, first, second);
    add(modelName, first);
  } else {
    add(first, modelName, second);
    add(modelName, first, second);
    add(second, modelName, first);
    add(modelName, first);
    add(first, modelName);
  }
  return rows;
}

export function composeKeywordElonMarketTitles<T extends MarketTitleRow>(input: {
  rows: T[];
  modelName: string;
  facts: KeywordElonFact[];
}): { rows: T[]; profileCounts: Record<KeywordElonMarketProfile, number>; adjustedCount: number } {
  const profileCounts: Record<KeywordElonMarketProfile, number> = {
    b2b: 0,
    naver: 0,
    coupang: 0,
    ably: 0,
    generic_retail: 0,
  };
  let adjustedCount = 0;

  const rows = input.rows.map((row, index) => {
    const profile = resolveKeywordElonMarketProfile(
      text(row.marketName),
      text(row.productGroup),
    );
    profileCounts[profile] += 1;
    const seed = [row.marketName, row.accountIdLabel, row.productGroup, index].join(":" );
    const ranked = rankedFacts(input.facts, profile, input.modelName, seed);
    const materials = ranked.slice(0, 6).map((fact) => fact.value);
    const candidates = candidatesForProfile(profile, input.modelName, materials)
      .filter((candidate) => validTitle(candidate, input.modelName));
    if (!candidates.length) return row;
    const selected = candidates[hash(seed) % candidates.length];
    if (!selected || canonical(selected) === canonical(row.title)) return row;
    adjustedCount += 1;
    return { ...row, title: selected };
  });

  return { rows, profileCounts, adjustedCount };
}
