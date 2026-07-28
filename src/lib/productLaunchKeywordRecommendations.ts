import { parseCsvRows } from "./keywordReviewQueue";

export type KeywordRecommendationQuality = "최적" | "추천" | "검토";

export type KeywordRecommendationItem = {
  keyword: string;
  score: number;
  quality: KeywordRecommendationQuality;
  source: string;
  selectedByEngine: boolean;
  safeAutoApply: boolean;
  totalSearch: number | null;
  competitionIndex: string;
  reason: string;
};

export type KeywordRecommendationGroup = {
  goodsKey: string;
  optimizedKeywords: string[];
  items: KeywordRecommendationItem[];
  qualityStatus: string;
  confidenceStatus: string;
  engineStatus: string;
  warnings: string[];
};

export type KeywordRecommendationArtifactResult = {
  requestId: string;
  goodsKeys: string[];
  status: string;
  groups: KeywordRecommendationGroup[];
  missingGoodsKeys: string[];
  extraGoodsKeys: string[];
};

type CsvRecord = Record<string, string>;

type CandidateSeed = {
  keyword: string;
  baseScore: number;
  quality: KeywordRecommendationQuality;
  source: string;
  selectedByEngine?: boolean;
  safeAutoApply?: boolean;
  totalSearch?: number | null;
  competitionIndex?: string;
  reason?: string;
};

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedHeader(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[\s-]+/g, "_");
}

function numberOrNull(value: unknown) {
  const normalized = text(value).replace(/,/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeKeyword(value: unknown) {
  return text(value)
    .replace(/^[\[\]{}()'"`]+|[\[\]{}()'"`]+$/g, "")
    .trim();
}

export function splitRecommendationTerms(value: unknown): string[] {
  if (Array.isArray(value)) {
    return dedupe(value.flatMap((item) => splitRecommendationTerms(item)));
  }
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    return dedupe(
      ["keyword", "token", "candidate_keyword", "text", "term"]
        .flatMap((key) => splitRecommendationTerms(objectValue[key]))
        .filter(Boolean),
    );
  }
  const raw = text(value);
  if (!raw) return [];
  if (
    (raw.startsWith("[") && raw.endsWith("]")) ||
    (raw.startsWith("{") && raw.endsWith("}"))
  ) {
    try {
      return splitRecommendationTerms(JSON.parse(raw.replace(/'/g, '"')));
    } catch {
      // Continue with delimiter parsing for Python-like or malformed lists.
    }
  }
  return dedupe(
    raw
      .replace(/^\[|\]$/g, "")
      .split(/[,，、;|\n]+/)
      .map(normalizeKeyword)
      .filter(Boolean),
  );
}

function dedupe(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.toLocaleLowerCase().replace(/\s+/g, "").trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function parseCsvRecords(csvText: string): CsvRecord[] {
  const [headers = [], ...rows] = parseCsvRows(csvText);
  if (!headers.length) return [];
  const normalizedHeaders = headers.map(normalizedHeader);
  return rows.map((row) =>
    Object.fromEntries(
      normalizedHeaders.map((header, index) => [header, text(row[index])]),
    ),
  );
}

function booleanValue(value: unknown) {
  return ["1", "true", "yes", "y", "pass", "ready", "approved"].includes(
    text(value).toLocaleLowerCase(),
  );
}

function passValue(value: unknown) {
  return ["pass", "passed", "success", "safe", "verified", "ready"].includes(
    text(value).toLocaleLowerCase(),
  );
}

function severeRejected(row: CsvRecord) {
  const tier = text(row.recommendation_tier).toUpperCase();
  const safety = text(row.safety_status).toUpperCase();
  const rejection = text(row.rejection_reason).toLocaleLowerCase();
  return (
    tier.startsWith("REJECTED") ||
    safety === "REJECTED" ||
    /drift|cross_category|attribute_only|unsupported_model|claim_risk/.test(
      rejection,
    )
  );
}

function approvalSafeForAuto(row: CsvRecord) {
  const noBlock =
    !text(row.block_reason) &&
    !text(row.non_approvable_reason) &&
    !booleanValue(row.auto_blocked);
  const explicitlyReady =
    booleanValue(row.apply_ready) ||
    booleanValue(row.review_passed) ||
    booleanValue(row.approvable) ||
    ["approved", "ready", "pass"].includes(
      text(row.approval_status).toLocaleLowerCase(),
    );
  const qualityPassed =
    passValue(row.site_srch_quality_status) &&
    passValue(row.final_site_srch_confidence_status);
  return noBlock && explicitlyReady && qualityPassed;
}

function upsertCandidate(
  map: Map<string, KeywordRecommendationItem>,
  seed: CandidateSeed,
  index = 0,
) {
  const keyword = normalizeKeyword(seed.keyword);
  if (!keyword) return;
  const identity = keyword.toLocaleLowerCase().replace(/\s+/g, "");
  const demandBonus =
    seed.totalSearch && seed.totalSearch > 0
      ? Math.min(300, Math.round(Math.log10(seed.totalSearch + 1) * 75))
      : 0;
  const score = seed.baseScore - index + demandBonus;
  const next: KeywordRecommendationItem = {
    keyword,
    score,
    quality: seed.quality,
    source: seed.source,
    selectedByEngine: seed.selectedByEngine === true,
    safeAutoApply: seed.safeAutoApply === true,
    totalSearch: seed.totalSearch ?? null,
    competitionIndex: text(seed.competitionIndex),
    reason: text(seed.reason),
  };
  const current = map.get(identity);
  if (!current || next.score > current.score) {
    map.set(identity, next);
    return;
  }
  if (next.safeAutoApply && !current.safeAutoApply) current.safeAutoApply = true;
  if (next.selectedByEngine && !current.selectedByEngine)
    current.selectedByEngine = true;
  if (!current.totalSearch && next.totalSearch)
    current.totalSearch = next.totalSearch;
}

function groupApprovalRecords(records: CsvRecord[]) {
  const grouped = new Map<string, CsvRecord[]>();
  for (const row of records) {
    const goodsKey = text(row.goods_key);
    if (!goodsKey) continue;
    grouped.set(goodsKey, [...(grouped.get(goodsKey) ?? []), row]);
  }
  return grouped;
}

function buildGroup(
  goodsKey: string,
  approvals: CsvRecord[],
  manuals: CsvRecord[],
  audits: CsvRecord[],
  engineStatus: string,
): KeywordRecommendationGroup {
  const candidateMap = new Map<string, KeywordRecommendationItem>();
  const primary =
    approvals.find((row) => text(row.new_site_srch)) ?? approvals[0] ?? {};
  const approvalSafe = approvalSafeForAuto(primary);
  const finalTerms = splitRecommendationTerms(primary.new_site_srch);
  finalTerms.forEach((keyword, index) =>
    upsertCandidate(
      candidateMap,
      {
        keyword,
        baseScore: 10_000,
        quality: approvalSafe ? "최적" : "검토",
        source: "엔진 최종 검색어",
        selectedByEngine: true,
        safeAutoApply: approvalSafe,
        reason: approvalSafe
          ? "keyword_engine_final_site_srch_quality_pass"
          : "keyword_engine_final_site_srch_requires_review",
      },
      index,
    ),
  );

  const safeTerms = dedupe(
    approvals.flatMap((row) =>
      splitRecommendationTerms(row.final_site_srch_safe_for_auto_apply_terms),
    ),
  );
  safeTerms.forEach((keyword, index) =>
    upsertCandidate(
      candidateMap,
      {
        keyword,
        baseScore: 9_500,
        quality: "최적",
        source: "자동 적용 안전 후보",
        safeAutoApply: true,
        reason: "safe_for_auto_apply",
      },
      index,
    ),
  );

  const promotedTerms = dedupe([
    ...approvals.flatMap((row) =>
      splitRecommendationTerms(row.auto_promoted_site_srch_terms),
    ),
    ...audits
      .filter((row) =>
        ["promoted", "accepted", "selected", "auto_promoted"].includes(
          text(row.decision).toLocaleLowerCase(),
        ),
      )
      .map((row) => text(row.candidate_keyword)),
  ]);
  promotedTerms.forEach((keyword, index) =>
    upsertCandidate(
      candidateMap,
      {
        keyword,
        baseScore: 8_500,
        quality: "추천",
        source: "자동 승격 후보",
        safeAutoApply: true,
        reason: "auto_promoted",
      },
      index,
    ),
  );

  const opportunityTerms = dedupe(
    approvals.flatMap((row) =>
      splitRecommendationTerms(row.top_opportunity_keywords),
    ),
  );
  opportunityTerms.forEach((keyword, index) =>
    upsertCandidate(
      candidateMap,
      {
        keyword,
        baseScore: 7_500,
        quality: "추천",
        source: "기회 키워드",
        safeAutoApply: false,
        reason: "top_opportunity_click_to_select",
      },
      index,
    ),
  );

  manuals
    .filter((row) => text(row.goods_key) === goodsKey && !severeRejected(row))
    .forEach((row, index) => {
      const tier = text(row.recommendation_tier).toUpperCase();
      const sellerQuality = text(row.seller_quality_status).toUpperCase();
      const safety = text(row.safety_status).toUpperCase();
      const verified = [
        "VERIFIED",
        "SAFE",
        "PASS",
        "SELLER_QUALITY_VERIFIED",
      ].includes(sellerQuality);
      const safeReview = tier === "SAFE_REVIEW" || verified;
      const needsReview =
        tier === "NEEDS_SOURCE_CHECK" || safety === "SOURCE_CHECK_REQUIRED";
      const safeAuto =
        safeReview &&
        safety !== "SOURCE_CHECK_REQUIRED" &&
        safety !== "REJECTED";
      upsertCandidate(
        candidateMap,
        {
          keyword: row.candidate_keyword,
          baseScore: safeReview ? 6_500 : needsReview ? 4_000 : 2_500,
          quality: safeReview ? "추천" : "검토",
          source: safeReview ? "검증 추천 후보" : "추가 검토 후보",
          safeAutoApply: safeAuto,
          totalSearch: numberOrNull(row.total_search),
          competitionIndex: row.comp_idx,
          reason:
            row.rejection_reason || row.searchad_related_evaluation_reason,
        },
        index,
      );
    });

  const items = [...candidateMap.values()]
    .sort(
      (a, b) =>
        b.score - a.score || a.keyword.localeCompare(b.keyword, "ko"),
    )
    .slice(0, 30);
  const optimizedKeywords = dedupe(
    items.filter((item) => item.safeAutoApply).map((item) => item.keyword),
  ).slice(0, 10);
  const warningSet = new Set<string>();
  for (const row of approvals) {
    for (const warning of splitRecommendationTerms(
      row.warning_flags || row.review_warnings,
    )) {
      warningSet.add(warning);
    }
  }
  if (!approvalSafe && finalTerms.length > 0) {
    warningSet.add(
      "엔진 최종 검색어의 품질·신뢰도·적용 준비 상태가 모두 PASS가 아니어서 자동 적용에서 제외했습니다.",
    );
  }
  if (optimizedKeywords.length < 10) {
    warningSet.add(
      `자동 적용 가능한 추천키워드가 ${optimizedKeywords.length}개입니다. 나머지는 직접 선택해야 합니다.`,
    );
  }
  return {
    goodsKey,
    optimizedKeywords,
    items,
    qualityStatus: text(primary.site_srch_quality_status),
    confidenceStatus: text(primary.final_site_srch_confidence_status),
    engineStatus,
    warnings: [...warningSet],
  };
}

function parseMeta(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      requestId: text(parsed.request_id),
      goodsKeys: Array.isArray(parsed.goods_keys)
        ? parsed.goods_keys.map(text).filter(Boolean)
        : [],
      status: text(parsed.status),
    };
  } catch {
    return { requestId: "", goodsKeys: [], status: "invalid_meta" };
  }
}

export function parseKeywordRecommendationArtifact(
  files: Record<string, string>,
  expectedGoodsKeys: string[] = [],
): KeywordRecommendationArtifactResult {
  const meta = parseMeta(files["keyword_engine_run_meta.json"] ?? "");
  const approvals = parseCsvRecords(
    files["keyword_mvp_approval_sheet.csv"] ?? "",
  );
  const manuals = parseCsvRecords(
    files["keyword_mvp_manual_candidates.csv"] ?? "",
  );
  const audits = parseCsvRecords(
    files["keyword_mvp_auto_promotion_audit.csv"] ?? "",
  );
  const approvalsByGoodsKey = groupApprovalRecords(approvals);
  const actualGoodsKeys = dedupe([
    ...meta.goodsKeys,
    ...approvals.map((row) => text(row.goods_key)),
    ...manuals.map((row) => text(row.goods_key)),
  ]).filter(Boolean);
  const expected = dedupe(expectedGoodsKeys.map(text).filter(Boolean));
  const targetGoodsKeys = expected.length ? expected : actualGoodsKeys;
  const groups = targetGoodsKeys.map((goodsKey) =>
    buildGroup(
      goodsKey,
      approvalsByGoodsKey.get(goodsKey) ?? [],
      manuals,
      audits.filter((row) => text(row.goods_key) === goodsKey),
      meta.status,
    ),
  );
  return {
    requestId: meta.requestId,
    goodsKeys: actualGoodsKeys,
    status: meta.status,
    groups,
    missingGoodsKeys: expected.filter(
      (goodsKey) => !actualGoodsKeys.includes(goodsKey),
    ),
    extraGoodsKeys: actualGoodsKeys.filter(
      (goodsKey) => expected.length > 0 && !expected.includes(goodsKey),
    ),
  };
}

export function toggleRecommendedKeyword(
  currentValue: string,
  keyword: string,
  limit = 10,
) {
  const current = splitRecommendationTerms(currentValue);
  const normalized = keyword.toLocaleLowerCase().replace(/\s+/g, "");
  const exists = current.some(
    (item) => item.toLocaleLowerCase().replace(/\s+/g, "") === normalized,
  );
  const next = exists
    ? current.filter(
        (item) =>
          item.toLocaleLowerCase().replace(/\s+/g, "") !== normalized,
      )
    : [...current, keyword].slice(0, limit);
  return next.join(",");
}

export function applyOptimizedRecommendedKeywords(
  optimizedKeywords: string[],
  limit = 10,
) {
  return dedupe(optimizedKeywords.map(normalizeKeyword).filter(Boolean))
    .slice(0, limit)
    .join(",");
}
