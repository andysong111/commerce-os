import {
  compactKeywordElonKey,
  uniqueKeywordElonCanonical,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonIdentity,
  type KeywordElonSearchAdStat,
} from "@/lib/keywordEngineElonLabV2";
import { mineKeywordElonApiHubMarket } from "@/lib/keywordEngineElonLabV2ApiHub";
import { discoverKeywordElonSearchAd } from "@/lib/keywordEngineElonLabV2SearchAd";

const EXPERIMENT_MODE = process.env.KEYWORD_THRESHOLD_EXPERIMENT_LOCAL_RUN === "1";
const STEP3_SEED_LIMIT = 8;
const STEP3_CANDIDATE_LIMIT = EXPERIMENT_MODE ? 140 : 300;
const STEP3_API_HUB_TERM_LIMIT = EXPERIMENT_MODE ? 60 : 90;
const STEP3_SEARCHAD_GLOBAL_LIMIT = EXPERIMENT_MODE ? 120 : 220;
const STEP3_SEARCHAD_PER_SEED_LIMIT = EXPERIMENT_MODE ? 35 : 60;
const STEP3_MIN_MONTHLY_SEARCH = 10;

function mergeStat(
  map: Map<string, KeywordElonSearchAdStat>,
  row: KeywordElonSearchAdStat,
) {
  const key = compactKeywordElonKey(row.keyword);
  if (!key) return;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, row);
    return;
  }
  const sourceSeeds = [...new Set([...(existing.sourceSeeds ?? []), ...(row.sourceSeeds ?? [])])];
  const existingDemand = existing.totalSearch ?? -1;
  const nextDemand = row.totalSearch ?? -1;
  map.set(key, { ...(nextDemand > existingDemand ? row : existing), sourceSeeds });
}

function existingKeys(
  discovery: KeywordElonDiscovery,
  candidates: KeywordElonCandidate[],
) {
  return new Set(
    [
      ...(discovery.candidates ?? []),
      ...candidates.map((row) => row.searchKeyword || row.searchKey || row.keyword),
    ]
      .map(compactKeywordElonKey)
      .filter(Boolean),
  );
}

function chooseSearchAdRows(
  rows: KeywordElonSearchAdStat[],
  seeds: string[],
  blocked: Set<string>,
) {
  const byKey = new Map<string, KeywordElonSearchAdStat>();
  const seedKeys = seeds.map(compactKeywordElonKey);
  const usable = rows.filter((row) => {
    const key = compactKeywordElonKey(row.keyword);
    const demand = row.totalSearch ?? 0;
    return Boolean(
      key
      && key.length >= 2
      && key.length <= 18
      && !blocked.has(key)
      && demand >= STEP3_MIN_MONTHLY_SEARCH,
    );
  });

  for (const seedKey of seedKeys) {
    const related = usable
      .filter((row) => (row.sourceSeeds ?? []).some((seed) => compactKeywordElonKey(seed) === seedKey))
      .sort(
        (a, b) => (b.totalSearch ?? -1) - (a.totalSearch ?? -1)
          || compactKeywordElonKey(a.keyword).length - compactKeywordElonKey(b.keyword).length,
      )
      .slice(0, STEP3_SEARCHAD_PER_SEED_LIMIT);
    for (const row of related) mergeStat(byKey, row);
  }

  const global = [...usable]
    .sort(
      (a, b) => new Set(b.sourceSeeds.map(compactKeywordElonKey)).size
          - new Set(a.sourceSeeds.map(compactKeywordElonKey)).size
        || (b.totalSearch ?? -1) - (a.totalSearch ?? -1)
        || compactKeywordElonKey(a.keyword).length - compactKeywordElonKey(b.keyword).length,
    )
    .slice(0, STEP3_SEARCHAD_GLOBAL_LIMIT);
  for (const row of global) mergeStat(byKey, row);

  return [...byKey.values()]
    .sort(
      (a, b) => (b.totalSearch ?? -1) - (a.totalSearch ?? -1)
        || compactKeywordElonKey(a.keyword).length - compactKeywordElonKey(b.keyword).length,
    )
    .slice(0, STEP3_SEARCHAD_GLOBAL_LIMIT);
}

function candidateTags(
  seeds: string[],
  evidenceTerms: string[],
  searchAdRows: KeywordElonSearchAdStat[],
) {
  const tags: Record<string, string[]> = {};
  const add = (keyword: string, tag: string) => {
    const key = compactKeywordElonKey(keyword);
    if (!key) return;
    tags[key] = [...new Set([...(tags[key] ?? []), tag])];
  };

  for (const seed of seeds) add(seed, "step3_pass_seed");
  for (const term of evidenceTerms) add(term, "step3_api_hub_evidence");
  for (const row of searchAdRows) {
    add(row.keyword, "step3_searchad_related");
    for (const seed of row.sourceSeeds ?? []) {
      add(row.keyword, `step3_related:${compactKeywordElonKey(seed)}`);
    }
  }
  return tags;
}

export async function expandKeywordElonFromPassing(input: {
  identity: KeywordElonIdentity;
  seedKeywords: string[];
  existingDiscovery: KeywordElonDiscovery;
  existingCandidates: KeywordElonCandidate[];
  round?: number;
}) {
  const seeds = uniqueKeywordElonCanonical(input.seedKeywords, STEP3_SEED_LIMIT);
  if (!seeds.length) {
    throw new Error("STEP3_NO_PASSING_SEED: STEP 2 통과키워드가 없어 추가발굴을 시작할 수 없습니다.");
  }

  const blocked = existingKeys(input.existingDiscovery, input.existingCandidates);
  const [apiHubSettled, searchAdSettled] = await Promise.allSettled([
    mineKeywordElonApiHubMarket(input.identity, seeds),
    discoverKeywordElonSearchAd(seeds),
  ]);

  const apiHub = apiHubSettled.status === "fulfilled"
    ? apiHubSettled.value
    : {
        configured: false,
        queries: seeds,
        documents: [],
        terms: [],
        activeSources: [],
        warnings: [
          `STEP3_API_HUB_FAILED:${apiHubSettled.reason instanceof Error ? apiHubSettled.reason.message : String(apiHubSettled.reason)}`,
        ],
      };
  const searchAd = searchAdSettled.status === "fulfilled"
    ? searchAdSettled.value
    : {
        configured: false,
        rows: [] as KeywordElonSearchAdStat[],
        warnings: [
          `STEP3_SEARCHAD_FAILED:${searchAdSettled.reason instanceof Error ? searchAdSettled.reason.message : String(searchAdSettled.reason)}`,
        ],
        expansionSeeds: [] as string[],
        explorationDepth: 1,
      };

  const evidenceTerms = uniqueKeywordElonCanonical(
    apiHub.terms.map((row) => row.term),
    STEP3_API_HUB_TERM_LIMIT,
  ).filter((term) => !blocked.has(term));
  const selectedSearchAdRows = chooseSearchAdRows(searchAd.rows, seeds, blocked);
  const searchAdTerms = selectedSearchAdRows.map((row) => compactKeywordElonKey(row.keyword));
  const candidates = uniqueKeywordElonCanonical(
    [...evidenceTerms, ...searchAdTerms],
    STEP3_CANDIDATE_LIMIT,
  ).filter((term) => !blocked.has(term));
  const candidateKeys = new Set(candidates);
  const searchAdStats = selectedSearchAdRows.filter((row) => candidateKeys.has(compactKeywordElonKey(row.keyword)));
  const sourceTagsByKeyword = candidateTags(seeds, evidenceTerms, searchAdStats);
  const round = Math.max(1, Math.floor(Number(input.round) || 1));

  const discovery: KeywordElonDiscovery = {
    candidates,
    sourceTagsByKeyword,
    searchAdStats,
    searchAdConfigured: searchAd.configured,
    searchAdWarnings: [
      ...apiHub.warnings,
      ...searchAd.warnings,
      `STEP3_EXPANSION_SUMMARY: round ${round} · 통과 Seed ${seeds.join(", ")} · API HUB 증거어 ${evidenceTerms.length}개 · SearchAd 후보 ${searchAdTerms.length}개 · 기존 제외 후 신규 ${candidates.length}개`,
    ].filter(Boolean).slice(0, 24),
    aiGeneratedCount: 0,
    relatedKeywordCount: searchAd.rows.length,
    demandExpansionSeeds: searchAd.expansionSeeds,
    demandExpansionSeedCount: searchAd.expansionSeeds.length,
    demandExplorationDepth: searchAd.explorationDepth,
    marketBridgeSeeds: seeds,
    marketTerms: evidenceTerms,
    apiHubConfigured: apiHub.configured,
    apiHubQueries: apiHub.queries,
    apiHubDocumentCount: apiHub.documents.length,
    apiHubActiveSources: apiHub.activeSources,
    apiHubEvidenceTerms: apiHub.terms,
    trendConfigured: input.existingDiscovery.trendConfigured,
    trendSignals: [],
    trendWarnings: [],
    marketRecallVersion: `v6-step3-r${round}`,
    model: "evidence-searchad-step3",
  };

  return {
    discovery,
    seedKeywords: seeds,
    round,
    newCandidateCount: candidates.length,
    apiHubEvidenceCount: evidenceTerms.length,
    searchAdCandidateCount: searchAdTerms.length,
    warnings: discovery.searchAdWarnings,
  };
}
