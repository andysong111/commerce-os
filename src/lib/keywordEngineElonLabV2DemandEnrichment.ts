import {
  calculateKeywordElonQuality,
  compactKeywordElonKey,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonSearchAdStat,
} from "@/lib/keywordEngineElonLabV2";
import { enrichKeywordElonSearchAdDemand } from "@/lib/keywordEngineElonLabV2SearchAd";
import { enrichKeywordElonSearchTrend } from "@/lib/keywordEngineElonLabV2Trend";

function statMap(rows: KeywordElonSearchAdStat[]) {
  return new Map(rows.map((row) => [compactKeywordElonKey(row.keyword), row] as const));
}

function sourcePriority(row: KeywordElonCandidate) {
  const tags = new Set(row.sourceTags ?? []);
  if (tags.has("api_hub_evidence_term") || tags.has("api_hub_market_term")) return 6;
  if ([...tags].some((tag) => tag.startsWith("api_hub_kin") || tag.startsWith("api_hub_cafe"))) return 5;
  if (tags.has("searchad_related") || tags.has("searchad_demand_depth2")) return 4;
  if (tags.has("market_bridge_seed")) return 3;
  if (tags.has("primary_seed") || tags.has("conditional_seed")) return 2;
  return 1;
}

function recalculateCandidate(row: KeywordElonCandidate, stats: Map<string, KeywordElonSearchAdStat>) {
  const key = compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword);
  const stat = stats.get(key);
  const calculated = calculateKeywordElonQuality({
    relevance: row.relevance,
    shoppingIntent: row.shoppingIntent,
    specificity: row.specificity,
    totalSearch: stat?.totalSearch ?? row.totalSearch ?? null,
    compIdx: stat?.compIdx ?? row.compIdx ?? null,
    plAvgDepth: stat?.plAvgDepth ?? row.plAvgDepth ?? null,
  });
  const totalSearch = stat?.totalSearch ?? row.totalSearch ?? null;
  const demandLabel = totalSearch === null ? "월검색 미측정" : `월검색 ${totalSearch.toLocaleString()}`;
  return {
    ...row,
    keyword: key,
    searchKey: key,
    searchKeyword: key,
    totalSearch,
    pcSearch: stat?.pcSearch ?? row.pcSearch ?? null,
    mobileSearch: stat?.mobileSearch ?? row.mobileSearch ?? null,
    compIdx: stat?.compIdx ?? row.compIdx ?? null,
    plAvgDepth: stat?.plAvgDepth ?? row.plAvgDepth ?? null,
    ...calculated,
    rationale: `${row.rationale.split(" · 안전Gate")[0]} · ${calculated.safetyReason} · ${demandLabel}`,
  } satisfies KeywordElonCandidate;
}

export async function enrichKeywordElonDemand(input: {
  candidates: KeywordElonCandidate[];
  discovery: KeywordElonDiscovery;
}) {
  const targets = input.candidates
    .filter((row) => row.safetyPass && row.totalSearch === null)
    .sort(
      (a, b) =>
        sourcePriority(b) - sourcePriority(a) ||
        compactKeywordElonKey(a.searchKeyword || a.searchKey || a.keyword).length - compactKeywordElonKey(b.searchKeyword || b.searchKey || b.keyword).length ||
        b.relevance - a.relevance ||
        b.shoppingIntent - a.shoppingIntent ||
        b.specificity - a.specificity,
    )
    .map((row) => compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword));

  const enrichment = await enrichKeywordElonSearchAdDemand(targets, input.discovery.searchAdStats);
  const stats = statMap(enrichment.rows);
  let candidates = input.candidates
    .map((row) => recalculateCandidate(row, stats))
    .sort(
      (a, b) =>
        Number(b.safetyPass) - Number(a.safetyPass) ||
        b.qualityScore - a.qualityScore ||
        (b.totalSearch ?? -1) - (a.totalSearch ?? -1),
    );

  const trend = await enrichKeywordElonSearchTrend(candidates);
  const trendMap = new Map(trend.signals.map((signal) => [compactKeywordElonKey(signal.keyword), signal] as const));
  candidates = candidates.map((row) => {
    const signal = trendMap.get(compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword));
    return signal ? { ...row, trendScore: signal.score, trendMomentum: signal.momentum } : row;
  });

  const discovery: KeywordElonDiscovery = {
    ...input.discovery,
    searchAdStats: enrichment.rows,
    trendConfigured: trend.configured,
    trendSignals: trend.signals,
    trendWarnings: trend.warnings,
    searchAdWarnings: [
      ...input.discovery.searchAdWarnings,
      ...enrichment.warnings,
      ...trend.warnings,
      `DEMAND_ENRICH_V6_SUMMARY: 안전Gate 통과 후 증거어 우선 월검색 미측정 후보 ${enrichment.requested.length}개 재조회 · 정확히 매칭 ${enrichment.exactMatched.length}개 · Search Trend ${trend.signals.length}/${trend.requested.length}개`,
    ].filter(Boolean).slice(0, 32),
  };

  return {
    candidates,
    discovery,
    requestedKeywords: enrichment.requested,
    exactMatchedKeywords: enrichment.exactMatched,
    warnings: [...enrichment.warnings, ...trend.warnings],
  };
}
