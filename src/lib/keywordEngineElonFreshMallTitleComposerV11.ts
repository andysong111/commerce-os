import {
  composeFreshKeywordElonMallTitles as composeFreshKeywordElonMallTitlesBase,
} from "./keywordEngineElonFreshMallTitleComposer.ts";
import type { KeywordElonSeoMarket } from "./keywordEngineElonLabSeoOutput.ts";
import type {
  KeywordElonMallTitleFactContext,
  KeywordElonMallTitleSafeComposerResult,
  KeywordElonSafeMallTitleRow,
} from "./keywordEngineElonMallTitleSafeComposer.ts";
import type { KeywordElonTitleExpansionMaterial } from "./keywordEngineElonTitleExpansion.ts";

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function canonical(value: unknown) {
  return text(value).replace(/\s+/g, "").toLowerCase();
}

function marketIdentity(market: KeywordElonSeoMarket) {
  return [market.productGroup, market.mallKey, market.accountIdLabel].map(text).join("|");
}

function rowIdentity(row: KeywordElonSafeMallTitleRow) {
  return [row.productGroup, row.mallKey, row.accountIdLabel].map(text).join("|");
}

function mayRecoverBySameMall(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return [
    "고유 쇼핑몰별 상품명",
    "카테고리 정합 상품명 후보가 부족합니다",
    "쇼핑몰별 상품명에 중복이 발생했습니다",
    "V7 상품명 포트폴리오 후보",
  ].some((token) => message.includes(token));
}

function groupsByMallKey(markets: KeywordElonSeoMarket[]) {
  const groups = new Map<string, KeywordElonSeoMarket[]>();
  for (const market of markets) {
    const key = text(market.mallKey) || marketIdentity(market);
    const rows = groups.get(key) ?? [];
    rows.push(market);
    groups.set(key, rows);
  }
  return groups;
}

function assertSameMallUnique(rows: KeywordElonSafeMallTitleRow[]) {
  const seenByMall = new Map<string, Set<string>>();
  for (const row of rows) {
    const mallKey = text(row.mallKey);
    const titleKey = canonical(row.title);
    const seen = seenByMall.get(mallKey) ?? new Set<string>();
    if (titleKey && seen.has(titleKey)) {
      throw new Error(`같은 쇼핑몰 계정 사이 상품명이 중복되었습니다: ${mallKey}`);
    }
    if (titleKey) seen.add(titleKey);
    seenByMall.set(mallKey, seen);
  }
}

export function composeFreshKeywordElonMallTitles(input: {
  markets: KeywordElonSeoMarket[];
  finalKeywords: string[];
  titleExpansionPool?: KeywordElonTitleExpansionMaterial[];
  modelName: string;
  context: KeywordElonMallTitleFactContext;
  blockedTerms?: string[];
  excludedTitles?: string[];
  variationSeed?: string;
}): KeywordElonMallTitleSafeComposerResult {
  try {
    // Keep the existing strongest policy first: all 29 rows remain globally unique
    // whenever the verified material pool can support it.
    return composeFreshKeywordElonMallTitlesBase(input);
  } catch (error) {
    if (!mayRecoverBySameMall(error)) throw error;
  }

  // Sparse products should not fail merely because unrelated marketplaces would reuse
  // the same safe title. The hard uniqueness boundary is the same mallKey/account family.
  const groups = groupsByMallKey(input.markets);
  const partials: KeywordElonMallTitleSafeComposerResult[] = [];
  const rowsByIdentity = new Map<string, KeywordElonSafeMallTitleRow>();

  for (const [mallKey, markets] of groups) {
    const partial = composeFreshKeywordElonMallTitlesBase({
      ...input,
      markets,
      variationSeed: `${text(input.variationSeed) || "seo-v11"}:mall:${mallKey}`,
    });
    partials.push(partial);
    for (const row of partial.rows) rowsByIdentity.set(rowIdentity(row), row);
  }

  const rows = input.markets.map((market) => rowsByIdentity.get(marketIdentity(market))).filter(
    (row): row is KeywordElonSafeMallTitleRow => Boolean(row),
  );
  if (rows.length !== input.markets.length) {
    throw new Error(`V11 쇼핑몰별 상품명 복구 행 수가 맞지 않습니다. 현재 ${rows.length}개`);
  }
  assertSameMallUnique(rows);

  const uniqueTitleCount = new Set(rows.map((row) => canonical(row.title)).filter(Boolean)).size;
  const globalReuseCount = Math.max(0, rows.length - uniqueTitleCount);
  const facts = [...new Set(partials.flatMap((partial) => partial.facts ?? []).map(text).filter(Boolean))];
  const warnings = [
    ...new Set(partials.flatMap((partial) => partial.warnings ?? []).map(text).filter(Boolean)),
    `SEO_RUN_V11_SAME_MALL_UNIQUENESS_FALLBACK:${groups.size}`,
    `SEO_RUN_V11_GLOBAL_TITLE_REUSE:${globalReuseCount}`,
  ];

  return {
    rows,
    facts,
    keywordCoverageCount: partials[0]?.keywordCoverageCount ?? input.finalKeywords.length,
    keywordCoverageTotal: partials[0]?.keywordCoverageTotal ?? input.finalKeywords.length,
    uniqueTitleCount,
    nearDuplicateCount: partials.reduce(
      (sum, partial) => sum + Math.max(0, Number(partial.nearDuplicateCount) || 0),
      0,
    ),
    warnings,
  };
}
