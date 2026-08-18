import {
  calculateKeywordElonQuality,
  compactKeywordElonKey,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonSearchAdStat,
} from "@/lib/keywordEngineElonLabV2";
import { enrichKeywordElonSearchAdDemand } from "@/lib/keywordEngineElonLabV2SearchAd";

function statMap(rows: KeywordElonSearchAdStat[]) {
  return new Map(rows.map((row) => [compactKeywordElonKey(row.keyword), row] as const));
}

function recalculateCandidate(row: KeywordElonCandidate, stats: Map<string, KeywordElonSearchAdStat>) {
  const stat = stats.get(compactKeywordElonKey(row.keyword));
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
        b.relevance - a.relevance ||
        b.shoppingIntent - a.shoppingIntent ||
        b.specificity - a.specificity,
    )
    .map((row) => row.keyword);

  const enrichment = await enrichKeywordElonSearchAdDemand(targets, input.discovery.searchAdStats);
  const stats = statMap(enrichment.rows);
  const candidates = input.candidates
    .map((row) => recalculateCandidate(row, stats))
    .sort(
      (a, b) =>
        Number(b.safetyPass) - Number(a.safetyPass) ||
        b.qualityScore - a.qualityScore ||
        (b.totalSearch ?? -1) - (a.totalSearch ?? -1),
    );

  const discovery: KeywordElonDiscovery = {
    ...input.discovery,
    searchAdStats: enrichment.rows,
    searchAdWarnings: [
      ...input.discovery.searchAdWarnings,
      ...enrichment.warnings,
      `DEMAND_ENRICH_SUMMARY: 안전Gate 통과 후 월검색 미측정 후보 ${enrichment.requested.length}개 재조회 · 정확히 매칭 ${enrichment.exactMatched.length}개`,
    ].filter(Boolean).slice(0, 24),
  };

  return {
    candidates,
    discovery,
    requestedKeywords: enrichment.requested,
    exactMatchedKeywords: enrichment.exactMatched,
    warnings: enrichment.warnings,
  };
}
