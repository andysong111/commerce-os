import {
  KEYWORD_ELON_V2_DEFAULT_CUTOFF,
  compactKeywordElonKey,
  parse1688OfferId,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonIdentity,
  type KeywordElonSourceDraft,
} from "@/lib/keywordEngineElonLabV2";
import { discoverKeywordElonCandidatesResilient } from "@/lib/keywordEngineElonLabV2Discovery";
import {
  mergeKeywordElonCandidates,
  mergeKeywordElonDiscovery,
} from "@/lib/keywordEngineElonLabV2Merge";
import { buildKeywordElonSeoModelPackage } from "@/lib/keywordEngineElonLabSeoModelOutput";
import { scoreKeywordElonCandidatesBatched } from "@/lib/keywordEngineElonLabV2Scoring";
import {
  analyzeKeywordElonIdentity,
  collectKeywordElon1688Source,
  generateKeywordElonTitle,
} from "@/lib/keywordEngineElonLabV2Server";
import { expandKeywordElonFromPassing } from "@/lib/keywordEngineElonLabV2Step3";
import { filterKeywordElonProhibitedKeywords } from "@/lib/keywordEngineElonLabV2Step4";
import {
  normalizeKeywordElonSelectionThresholds,
  selectKeywordElonStep4Union,
} from "@/lib/keywordEngineElonLabV2Selection";
import { PRODUCT_GROUP_MARKET_REGISTRY } from "@/lib/productGroupMarketRegistry";

const SHOPLING_GROUPS = [
  ["wholesale1", "도매1"],
  ["wholesale2", "도매2"],
  ["wholesale3", "도매3"],
  ["wholesale4", "도매4"],
  ["retail1", "소매1"],
  ["retail2", "소매2"],
] as const;

export type KeywordElonBulkFinalInput = {
  launchItemId: string;
  modelNumber: string;
  productName: string;
  sourceUrl: string;
  optionText?: string;
  supportingText?: string;
  customBlockedTerms?: string[];
};

export type KeywordElonBulkFinalResult = {
  launchItemId: string;
  modelNumber: string;
  productName: string;
  sourceUrl: string;
  collectionMode: "1688_server" | "tracker_fallback";
  sourceWarnings: string[];
  identity: KeywordElonIdentity;
  candidateCount: number;
  finalMaterialCount: number;
  seoFinal: {
    productName: string;
    groupProductNames: Record<string, string>;
    searchKeywords: string[];
    searchLine: string;
    source: string;
    sourceUrl: string;
    offerId: string;
    generatedAt: string;
    mallTitles: Array<{
      productGroup: string;
      marketName: string;
      mallKey: string;
      accountIdLabel: string;
      title: string;
    }>;
  };
  warnings: string[];
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function unique(values: unknown[], limit = 120) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = text(value);
    if (!normalized) continue;
    const key = normalized.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function passingRows(candidates: KeywordElonCandidate[]) {
  return candidates
    .filter((row) => row.safetyPass && row.qualityScore >= KEYWORD_ELON_V2_DEFAULT_CUTOFF)
    .sort(
      (a, b) =>
        b.qualityScore - a.qualityScore ||
        (b.totalSearch ?? -1) - (a.totalSearch ?? -1),
    );
}

function seedRows(candidates: KeywordElonCandidate[]) {
  return unique(
    passingRows(candidates).map(
      (row) => row.searchKeyword || row.searchKey || row.keyword,
    ),
    8,
  );
}

function trackerFallbackSource(input: KeywordElonBulkFinalInput): KeywordElonSourceDraft {
  const optionText = text(input.optionText);
  const supportingText = [
    text(input.supportingText),
    input.modelNumber ? `모델번호 ${input.modelNumber}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    url: text(input.sourceUrl),
    offerId: parse1688OfferId(input.sourceUrl),
    autoStatus: "partial",
    chineseTitle: text(input.productName),
    optionText,
    supportingText,
    warnings: ["BULK_TRACKER_SOURCE_FALLBACK"],
    collectedAt: new Date().toISOString(),
  };
}

async function collectSource(input: KeywordElonBulkFinalInput) {
  try {
    const source = await collectKeywordElon1688Source(input.sourceUrl);
    if (source.chineseTitle.trim() || source.optionText.trim()) {
      return { source, mode: "1688_server" as const };
    }
  } catch {
    // Product Launch Tracker data is the deterministic fallback for cloud-blocked 1688 fetches.
  }
  return { source: trackerFallbackSource(input), mode: "tracker_fallback" as const };
}

export async function generateKeywordElonBulkFinal(
  input: KeywordElonBulkFinalInput,
): Promise<KeywordElonBulkFinalResult> {
  if (!text(input.launchItemId)) throw new Error("출시 상품 ID가 없습니다.");
  if (!text(input.sourceUrl)) throw new Error("1688 상품 링크가 없습니다.");

  const collected = await collectSource(input);
  const source = collected.source;
  const identity = await analyzeKeywordElonIdentity(source);

  let discovery: KeywordElonDiscovery = await discoverKeywordElonCandidatesResilient(
    source,
    identity,
  );
  const firstScored = await scoreKeywordElonCandidatesBatched({
    source,
    identity,
    discovery,
  });
  let candidates = firstScored.candidates;

  for (let round = 1; round <= 3; round += 1) {
    const seeds = seedRows(candidates);
    if (!seeds.length) break;
    const expanded = await expandKeywordElonFromPassing({
      identity,
      seedKeywords: seeds,
      existingDiscovery: discovery,
      existingCandidates: candidates,
      round,
    });
    if (!expanded.newCandidateCount || !expanded.discovery.candidates.length) continue;
    const scored = await scoreKeywordElonCandidatesBatched({
      source,
      identity,
      discovery: expanded.discovery,
    });
    candidates = mergeKeywordElonCandidates(candidates, scored.candidates);
    discovery = mergeKeywordElonDiscovery(discovery, expanded.discovery);
  }

  const thresholds = normalizeKeywordElonSelectionThresholds();
  const step4Candidates = selectKeywordElonStep4Union(candidates, thresholds);
  if (!step4Candidates.length) {
    throw new Error("STEP 4에 전달할 최종 후보가 없습니다.");
  }

  const filtered = await filterKeywordElonProhibitedKeywords({
    identity,
    candidates: step4Candidates,
    customBlockedTerms: unique(input.customBlockedTerms ?? []),
  });
  const allowedKeys = new Set(filtered.allowedKeys);
  const allowedCandidates = step4Candidates.filter((row) =>
    allowedKeys.has(
      compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword),
    ),
  );
  if (!allowedCandidates.length) {
    throw new Error("금지키워드 제거 후 사용할 SEO 재료가 없습니다.");
  }

  const titleResult = await generateKeywordElonTitle({
    source,
    identity,
    candidates: allowedCandidates,
    cutoff: 0,
  });
  const blockedKeys = filtered.decisions
    .filter((row) => row.blocked === true)
    .map((row) => row.key || row.keyword || "")
    .filter(Boolean);
  const output = buildKeywordElonSeoModelPackage(
    {
      identity,
      candidates,
      allowedKeys: filtered.allowedKeys,
      blockedKeys,
      customBlockedTerms: unique(input.customBlockedTerms ?? []),
      titleResult,
    },
    PRODUCT_GROUP_MARKET_REGISTRY,
  );

  if (output.commonSearchKeywords.length !== 10) {
    throw new Error(
      `FINAL 검색어가 10개가 아닙니다. 현재 ${output.commonSearchKeywords.length}개`,
    );
  }
  if (output.mallTitles.length !== 29) {
    throw new Error(`쇼핑몰별 상품명이 29개가 아닙니다. 현재 ${output.mallTitles.length}개`);
  }

  const groupProductNames: Record<string, string> = {};
  for (const [key, label] of SHOPLING_GROUPS) {
    const title = output.mallTitles.find((row) => row.productGroup === label)?.title;
    if (!title) throw new Error(`${label} 기준 상품명을 만들지 못했습니다.`);
    groupProductNames[key] = title;
  }

  const generatedAt = new Date().toISOString();
  return {
    launchItemId: input.launchItemId,
    modelNumber: input.modelNumber,
    productName: input.productName,
    sourceUrl: input.sourceUrl,
    collectionMode: collected.mode,
    sourceWarnings: source.warnings ?? [],
    identity,
    candidateCount: candidates.length,
    finalMaterialCount: filtered.allowedCount,
    seoFinal: {
      productName: output.modelName,
      groupProductNames,
      searchKeywords: [...output.commonSearchKeywords],
      searchLine: output.commonSearchKeywords.join(","),
      source: "seo-bulk-cloud",
      sourceUrl: input.sourceUrl,
      offerId: source.offerId || parse1688OfferId(input.sourceUrl),
      generatedAt,
      mallTitles: output.mallTitles.map((row) => ({
        productGroup: row.productGroup,
        marketName: row.marketName,
        mallKey: row.mallKey,
        accountIdLabel: row.accountIdLabel,
        title: row.title,
      })),
    },
    warnings: [...output.warnings, ...(source.warnings ?? [])],
  };
}
