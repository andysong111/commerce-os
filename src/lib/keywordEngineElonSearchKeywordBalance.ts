import {
  keywordElonSeoCanonical,
  type KeywordElonSeoIdentity,
  type KeywordElonSeoSearchKeyword,
} from "@/lib/keywordEngineElonLabSeoOutput";

export type KeywordElonSearchKeywordRole =
  | "CORE"
  | "SYNONYM"
  | "USE"
  | "FUNCTION"
  | "CONTEXT"
  | "FORM"
  | "SPEC";

export type KeywordElonSearchKeywordTier = "A" | "B";

export type BalancedKeyword = {
  keyword: string;
  role: KeywordElonSearchKeywordRole;
  tier: KeywordElonSearchKeywordTier;
  score: number;
};

export type BalancedKeywordResult = {
  keywords: string[];
  details: BalancedKeyword[];
  roleCounts: Record<KeywordElonSearchKeywordRole, number>;
  tierCounts: Record<KeywordElonSearchKeywordTier, number>;
  warnings: string[];
};

const FUNCTION_PATTERN = /(청소|지압|마사지|수납|정리|보관|고정|보호|제거|세척|건조|거치|압출|천공|밀봉|차단|흡수|미끄럼방지)/i;
const CONTEXT_PATTERN = /(주방|욕실|화장실|차량|자동차|사무실|실내|야외|캠핑|여행|현관|창틀|책상|침실|거실|학교|홈트)/i;
const FORM_PATTERN = /(원형|사각|직사각|슬림|롱|미니|소형|대형|접이식|걸이형|스텝형|판형|보드형|파우치형|케이스형|브러시|브러쉬|스텝퍼|거치대|수납함|파우치|노트|수건|판)$/i;
const SPEC_PATTERN = /\d+(?:\.\d+)?(?:mm|cm|m|ml|l|g|kg|개|매|장|쌍|세트|입|호|인치)/i;
const MAX_FALLBACK_KEYWORD_LENGTH = 20;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function compact(value: unknown) {
  return keywordElonSeoCanonical(value);
}

function number100(value: unknown, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, numeric));
}

function demand(row?: KeywordElonSeoSearchKeyword) {
  if (!row) return 0;
  const explicit = Number(row.demandScore);
  if (Number.isFinite(explicit)) return number100(explicit);
  const total = Number(row.totalSearch);
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.log10(total + 1) * 22);
}

function keywordScore(row?: KeywordElonSeoSearchKeyword) {
  if (!row) return 42;
  return (
    number100(row.relevance, 70) * 0.34 +
    number100(row.qualityScore, 60) * 0.20 +
    number100(row.shoppingIntent, 70) * 0.17 +
    number100(row.specificity, 65) * 0.15 +
    demand(row) * 0.14
  );
}

function overlaps(value: string, materials: unknown[]) {
  const key = compact(value);
  return materials.some((material) => {
    const materialKey = compact(material);
    return Boolean(
      key && materialKey &&
      (key === materialKey || key.includes(materialKey) || materialKey.includes(key))
    );
  });
}

function roleForKeyword(
  value: string,
  identity: KeywordElonSeoIdentity,
): KeywordElonSearchKeywordRole {
  const key = compact(value);
  const coreKey = compact(identity.coreProduct);
  if (coreKey && (key === coreKey || key.includes(coreKey) || coreKey.includes(key))) return "CORE";
  if (SPEC_PATTERN.test(key) || overlaps(key, identity.specAttributes ?? [])) return "SPEC";
  if (CONTEXT_PATTERN.test(key) || overlaps(key, identity.conditionalSeeds ?? [])) return "CONTEXT";
  if (FUNCTION_PATTERN.test(key) || overlaps(key, identity.functionModifiers ?? [])) return "FUNCTION";
  if (FORM_PATTERN.test(key) || overlaps(key, identity.designShapeModifiers ?? [])) return "FORM";
  if (/용$/.test(key)) return "USE";
  return "SYNONYM";
}

function nearDuplicate(left: string, right: string) {
  const a = compact(left);
  const b = compact(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if ((a.includes(b) || b.includes(a)) && Math.abs(a.length - b.length) <= 3) return true;
  return false;
}

function addGroundedCombinationCandidates(input: {
  candidates: BalancedKeyword[];
  seen: Set<string>;
  identity: KeywordElonSeoIdentity;
  targetCount: number;
}) {
  if (input.candidates.length >= input.targetCount) return 0;
  const materials = [...input.candidates]
    .sort((left, right) => right.score - left.score || left.keyword.length - right.keyword.length)
    .slice(0, 14);
  const before = input.candidates.length;

  const addCombination = (parts: BalancedKeyword[]) => {
    const partKeys = parts.map((row) => compact(row.keyword)).filter(Boolean);
    if (new Set(partKeys).size !== partKeys.length) return;
    if (
      partKeys.some((key, index) =>
        partKeys.some(
          (other, otherIndex) =>
            index !== otherIndex && (key.includes(other) || other.includes(key)),
        ),
      )
    ) {
      return;
    }
    const keyword = compact(parts.map((row) => row.keyword).join(""));
    if (
      !keyword ||
      keyword.length < 2 ||
      keyword.length > MAX_FALLBACK_KEYWORD_LENGTH ||
      input.seen.has(keyword)
    ) {
      return;
    }
    input.seen.add(keyword);
    input.candidates.push({
      keyword,
      role: roleForKeyword(keyword, input.identity),
      tier: "B",
      score: Math.max(1, Math.min(...parts.map((row) => row.score)) - (parts.length === 2 ? 6 : 12)),
    });
  };

  for (let left = 0; left < materials.length; left += 1) {
    for (let right = 0; right < materials.length; right += 1) {
      if (left === right) continue;
      addCombination([materials[left], materials[right]]);
      if (input.candidates.length >= Math.max(input.targetCount * 3, 30)) {
        return input.candidates.length - before;
      }
    }
  }

  if (input.candidates.length < input.targetCount) {
    const compactMaterials = materials.slice(0, 8);
    for (let first = 0; first < compactMaterials.length; first += 1) {
      for (let second = 0; second < compactMaterials.length; second += 1) {
        if (second === first) continue;
        for (let third = 0; third < compactMaterials.length; third += 1) {
          if (third === first || third === second) continue;
          addCombination([
            compactMaterials[first],
            compactMaterials[second],
            compactMaterials[third],
          ]);
          if (input.candidates.length >= Math.max(input.targetCount * 3, 30)) {
            return input.candidates.length - before;
          }
        }
      }
    }
  }
  return input.candidates.length - before;
}

export function selectBalancedKeywordElonSearchKeywords(input: {
  identity: KeywordElonSeoIdentity;
  searchKeywordDetails: KeywordElonSeoSearchKeyword[];
  baseKeywords: string[];
  supplementalKeywords?: string[];
  limit?: number;
}): BalancedKeywordResult {
  const limit = Math.max(1, Math.min(20, Math.trunc(Number(input.limit) || 10)));
  const detailsByKey = new Map<string, KeywordElonSeoSearchKeyword>();
  for (const row of input.searchKeywordDetails ?? []) {
    const key = compact(row.keyword);
    if (!key) continue;
    const current = detailsByKey.get(key);
    if (!current || keywordScore(row) > keywordScore(current)) detailsByKey.set(key, row);
  }

  const values = [
    ...(input.baseKeywords ?? []),
    ...(input.searchKeywordDetails ?? []).map((row) => row.keyword),
    ...(input.supplementalKeywords ?? []),
    input.identity.coreProduct,
    input.identity.koreanProductIdentity,
    input.identity.identityAnchor,
    ...(input.identity.primarySeeds ?? []),
    ...(input.identity.functionModifiers ?? []),
    ...(input.identity.conditionalSeeds ?? []),
    ...(input.identity.designShapeModifiers ?? []),
    ...(input.identity.specAttributes ?? []),
  ];

  const candidates: BalancedKeyword[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const keyword = compact(value);
    if (!keyword || keyword.length < 2 || seen.has(keyword)) continue;
    seen.add(keyword);
    const detail = detailsByKey.get(keyword);
    candidates.push({
      keyword,
      role: roleForKeyword(keyword, input.identity),
      tier:
        detail &&
        number100(detail.relevance, 0) >= 70 &&
        number100(detail.qualityScore, 0) >= 55
          ? "A"
          : "B",
      score: keywordScore(detail),
    });
  }

  const generatedFallbackCount = addGroundedCombinationCandidates({
    candidates,
    seen,
    identity: input.identity,
    targetCount: limit,
  });

  candidates.sort((left, right) => {
    if (left.tier !== right.tier) return left.tier === "A" ? -1 : 1;
    return right.score - left.score || right.keyword.length - left.keyword.length;
  });

  const roleOrder: KeywordElonSearchKeywordRole[] = [
    "CORE",
    "SYNONYM",
    "USE",
    "FUNCTION",
    "CONTEXT",
    "FORM",
    "SPEC",
  ];
  const selected: BalancedKeyword[] = [];
  const selectedKeys = new Set<string>();

  const add = (candidate: BalancedKeyword, allowNear = false) => {
    if (selected.length >= limit || selectedKeys.has(candidate.keyword)) return;
    if (!allowNear && selected.some((row) => nearDuplicate(row.keyword, candidate.keyword))) return;
    selected.push(candidate);
    selectedKeys.add(candidate.keyword);
  };

  for (const role of roleOrder) {
    const roleRows = candidates.filter((row) => row.role === role);
    const quota = role === "CORE" || role === "SYNONYM" ? 2 : 1;
    for (const row of roleRows.slice(0, quota)) add(row);
  }
  for (const row of candidates) add(row);
  for (const row of candidates) add(row, true);

  const keywords = selected.slice(0, limit).map((row) => row.keyword);
  const roleCounts = Object.fromEntries(roleOrder.map((role) => [role, 0])) as Record<
    KeywordElonSearchKeywordRole,
    number
  >;
  const tierCounts: Record<KeywordElonSearchKeywordTier, number> = { A: 0, B: 0 };
  for (const row of selected.slice(0, limit)) {
    roleCounts[row.role] += 1;
    tierCounts[row.tier] += 1;
  }

  const warnings: string[] = [];
  if (generatedFallbackCount > 0) {
    warnings.push(`SEO_SEARCH_KEYWORD_GROUNDED_FILL:${generatedFallbackCount}`);
  }
  if (keywords.length < limit) warnings.push(`SEO_SEARCH_KEYWORD_SHORTAGE:${limit - keywords.length}`);
  if (tierCounts.B > 0) warnings.push(`SEO_SEARCH_KEYWORD_TIER_B:${tierCounts.B}`);
  return {
    keywords,
    details: selected.slice(0, limit),
    roleCounts,
    tierCounts,
    warnings,
  };
}
