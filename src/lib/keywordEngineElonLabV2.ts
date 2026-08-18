export const KEYWORD_ELON_V2_STORAGE_KEY = "keywordEngineElonLab.v2.session";
export const KEYWORD_ELON_V2_DEFAULT_CUTOFF = 70;
export const KEYWORD_ELON_V2_MINIMUM_KEYWORDS = 10;
export const KEYWORD_ELON_V2_RELEVANCE_GATE = 80;
export const KEYWORD_ELON_V2_SHOPPING_INTENT_GATE = 70;

export type KeywordElonSourceDraft = {
  url: string;
  offerId: string;
  autoStatus: "idle" | "success" | "partial" | "failed";
  chineseTitle: string;
  optionText: string;
  supportingText: string;
  warnings: string[];
  collectedAt: string;
};

export type KeywordElonIdentity = {
  koreanProductIdentity: string;
  coreProduct: string;
  identityAnchor: string;
  primarySeeds: string[];
  conditionalSeeds: string[];
  functionModifiers: string[];
  designShapeModifiers: string[];
  specAttributes: string[];
  variantNoise: string[];
  confidence: number;
  reasoning: string;
  model: string;
};

export type KeywordElonSearchAdStat = {
  keyword: string;
  relKeyword: string;
  totalSearch: number | null;
  pcSearch: number | null;
  mobileSearch: number | null;
  compIdx: string | number | null;
  plAvgDepth: number | null;
  monthlyAvePcClicks: number | null;
  monthlyAveMobileClicks: number | null;
  monthlyAvePcCtr: number | null;
  monthlyAveMobileCtr: number | null;
  sourceSeeds: string[];
};

export type KeywordElonSemanticScore = {
  keyword: string;
  relevance: number;
  shoppingIntent: number;
  specificity: number;
  titleEligible: boolean;
  rationale: string;
};

export type KeywordElonCandidate = KeywordElonSemanticScore & {
  searchKey: string;
  sourceTags: string[];
  totalSearch: number | null;
  pcSearch: number | null;
  mobileSearch: number | null;
  compIdx: string | number | null;
  plAvgDepth: number | null;
  demandScore: number;
  competitionOpportunity: number;
  qualityScore: number;
  safetyPass: boolean;
  safetyReason: string;
  dataConfidence: "high" | "medium" | "low";
};

export type KeywordElonDiscovery = {
  candidates: string[];
  sourceTagsByKeyword: Record<string, string[]>;
  searchAdStats: KeywordElonSearchAdStat[];
  searchAdConfigured: boolean;
  searchAdWarnings: string[];
  aiGeneratedCount: number;
  relatedKeywordCount: number;
  demandExpansionSeeds: string[];
  demandExpansionSeedCount: number;
  demandExplorationDepth: number;
  model: string;
};

export type KeywordElonTitleResult = {
  title: string;
  usedKeywords: string[];
  byteLength: number;
  model: string;
  warning: string;
};

export type KeywordElonLabSession = {
  version: 2;
  source: KeywordElonSourceDraft;
  identity: KeywordElonIdentity | null;
  stage1Review: "pending" | "pass" | "improve";
  discovery: KeywordElonDiscovery | null;
  scoredCandidates: KeywordElonCandidate[];
  cutoff: number;
  titleResult: KeywordElonTitleResult | null;
  stage2Status: "idle" | "discovering" | "scoring" | "title" | "done" | "error";
  lastMessage: string;
  updatedAt: string;
};

export function emptyKeywordElonSession(): KeywordElonLabSession {
  return {
    version: 2,
    source: {
      url: "",
      offerId: "",
      autoStatus: "idle",
      chineseTitle: "",
      optionText: "",
      supportingText: "",
      warnings: [],
      collectedAt: "",
    },
    identity: null,
    stage1Review: "pending",
    discovery: null,
    scoredCandidates: [],
    cutoff: KEYWORD_ELON_V2_DEFAULT_CUTOFF,
    titleResult: null,
    stage2Status: "idle",
    lastMessage: "",
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeKeywordElonText(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function compactKeywordElonKey(value: unknown) {
  return normalizeKeywordElonText(value)
    .replace(/[^0-9A-Za-z가-힣]/g, "")
    .toLocaleLowerCase();
}

export function uniqueKeywordElonTexts(values: unknown[], limit = 500) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = normalizeKeywordElonText(value);
    const key = compactKeywordElonKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

export function keywordElonUtf8Bytes(value: string) {
  return new TextEncoder().encode(value).length;
}

export function parse1688OfferId(value: string) {
  const normalized = normalizeKeywordElonText(value);
  const pathMatch = normalized.match(/\/offer\/(\d+)\.html/i);
  if (pathMatch?.[1]) return pathMatch[1];
  try {
    const url = new URL(normalized);
    return url.searchParams.get("offerId") || url.searchParams.get("offer_id") || "";
  } catch {
    return "";
  }
}

export function validate1688Url(value: string) {
  const normalized = normalizeKeywordElonText(value);
  try {
    const url = new URL(normalized);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return host === "1688.com" || host.endsWith(".1688.com");
  } catch {
    return false;
  }
}

function clamp100(value: number) {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

const DEMAND_SCORE_ANCHORS = [
  [0, 0],
  [10, 20],
  [50, 35],
  [200, 50],
  [1_000, 65],
  [5_000, 80],
  [20_000, 90],
  [100_000, 100],
] as const;

export function keywordElonDemandScore(totalSearch: number | null) {
  if (totalSearch === null || !Number.isFinite(totalSearch)) return 15;
  const value = Math.max(0, totalSearch);
  if (value <= 0) return 0;
  if (value >= 100_000) return 100;

  for (let index = 1; index < DEMAND_SCORE_ANCHORS.length; index += 1) {
    const [upperSearch, upperScore] = DEMAND_SCORE_ANCHORS[index];
    if (value > upperSearch) continue;
    const [lowerSearch, lowerScore] = DEMAND_SCORE_ANCHORS[index - 1];
    if (lowerSearch === 0) {
      return clamp100(lowerScore + ((value - lowerSearch) / (upperSearch - lowerSearch)) * (upperScore - lowerScore));
    }
    const lowerLog = Math.log10(lowerSearch);
    const upperLog = Math.log10(upperSearch);
    const valueLog = Math.log10(Math.max(1, value));
    const ratio = (valueLog - lowerLog) / Math.max(0.0001, upperLog - lowerLog);
    return clamp100(lowerScore + ratio * (upperScore - lowerScore));
  }
  return 100;
}

export function keywordElonCompetitionOpportunity(compIdx: string | number | null, plAvgDepth: number | null) {
  const normalized = String(compIdx ?? "").trim().toUpperCase();
  let comp = 55;
  if (["LOW", "L", "낮음"].includes(normalized)) comp = 90;
  else if (["MID", "MEDIUM", "M", "중", "중간"].includes(normalized)) comp = 65;
  else if (["HIGH", "H", "높음"].includes(normalized)) comp = 40;
  else if (typeof compIdx === "number" && Number.isFinite(compIdx)) comp = clamp100(100 - compIdx);

  if (plAvgDepth === null || !Number.isFinite(plAvgDepth)) return clamp100(comp);
  const depthOpportunity = clamp100(100 - Math.min(80, Math.max(0, plAvgDepth) * 5));
  return clamp100(comp * 0.65 + depthOpportunity * 0.35);
}

export function calculateKeywordElonQuality(input: {
  relevance: number;
  shoppingIntent: number;
  specificity: number;
  totalSearch: number | null;
  compIdx: string | number | null;
  plAvgDepth: number | null;
}) {
  const demandScore = keywordElonDemandScore(input.totalSearch);
  const competitionOpportunity = keywordElonCompetitionOpportunity(input.compIdx, input.plAvgDepth);
  const safetyPass =
    input.relevance >= KEYWORD_ELON_V2_RELEVANCE_GATE &&
    input.shoppingIntent >= KEYWORD_ELON_V2_SHOPPING_INTENT_GATE;
  const safetyReason = safetyPass
    ? `안전Gate 통과 · 관련성 ${input.relevance.toFixed(0)} / 쇼핑의도 ${input.shoppingIntent.toFixed(0)}`
    : `안전Gate 탈락 · 관련성 ${input.relevance.toFixed(0)} / 쇼핑의도 ${input.shoppingIntent.toFixed(0)} (기준 ${KEYWORD_ELON_V2_RELEVANCE_GATE}/${KEYWORD_ELON_V2_SHOPPING_INTENT_GATE})`;

  const opportunityScore = clamp100(
    demandScore * 0.55 +
      input.relevance * 0.2 +
      input.shoppingIntent * 0.1 +
      competitionOpportunity * 0.1 +
      input.specificity * 0.05,
  );
  const qualityScore = safetyPass ? opportunityScore : 0;
  return { demandScore, competitionOpportunity, qualityScore, safetyPass, safetyReason };
}
