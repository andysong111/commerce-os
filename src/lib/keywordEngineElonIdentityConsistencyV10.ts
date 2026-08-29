import {
  compactKeywordElonKey,
  normalizeKeywordElonText,
  type KeywordElonIdentity,
} from "@/lib/keywordEngineElonLabV2";

export type KeywordElonIdentityConsistencyDecisionV10 = {
  blocked: boolean;
  reasons: string[];
  matchedTerms: string[];
};

const GUN_IDENTITY_PATTERN = /(청소건|세척건|스프레이건|분사건|호스건|워터건|욕실건|화장실건|건$)/;
const GUN_COMPATIBLE_MARKERS = [
  "건",
  "스프레이",
  "분사",
  "샤워",
  "호스",
  "워터",
  "분무",
] as const;
const GUN_INCOMPATIBLE_FORMS = [
  "스퀴지",
  "밀대",
  "걸레",
  "청소봉",
  "바닥솔",
  "물기제거기",
] as const;
const UNSUPPORTED_CAPABILITY_TERMS = [
  "전동",
  "무선",
  "충전",
  "배터리",
  "자동",
] as const;

function identityEvidence(identity: KeywordElonIdentity) {
  return [
    identity.koreanProductIdentity,
    identity.coreProduct,
    identity.identityAnchor,
    ...(identity.primarySeeds ?? []),
    ...(identity.conditionalSeeds ?? []),
    ...(identity.functionModifiers ?? []),
    ...(identity.designShapeModifiers ?? []),
    ...(identity.specAttributes ?? []),
  ]
    .map(normalizeKeywordElonText)
    .filter(Boolean)
    .join(" ");
}

function gunIdentity(identity: KeywordElonIdentity) {
  const anchor = compactKeywordElonKey(
    [identity.coreProduct, identity.identityAnchor, identity.koreanProductIdentity]
      .filter(Boolean)
      .join(" "),
  );
  return GUN_IDENTITY_PATTERN.test(anchor);
}

function includesAny(value: string, terms: readonly string[]) {
  return terms.some((term) => value.includes(compactKeywordElonKey(term)));
}

export function evaluateKeywordElonIdentityConsistencyV10(input: {
  identity: KeywordElonIdentity;
  keyword: string;
}): KeywordElonIdentityConsistencyDecisionV10 {
  const keyword = compactKeywordElonKey(input.keyword);
  if (!keyword) return { blocked: true, reasons: ["빈 키워드"], matchedTerms: [] };

  const reasons: string[] = [];
  const matchedTerms: string[] = [];
  const evidence = compactKeywordElonKey(identityEvidence(input.identity));

  for (const term of UNSUPPORTED_CAPABILITY_TERMS) {
    const key = compactKeywordElonKey(term);
    if (!keyword.includes(key) || evidence.includes(key)) continue;
    reasons.push(`상품 원문·정체성에 확인되지 않은 기능 '${term}' 포함`);
    matchedTerms.push(term);
  }

  if (gunIdentity(input.identity)) {
    for (const form of GUN_INCOMPATIBLE_FORMS) {
      const key = compactKeywordElonKey(form);
      if (!keyword.includes(key)) continue;
      reasons.push(`분사/세척형 건 제품과 다른 제품형태 '${form}' 포함`);
      matchedTerms.push(form);
    }

    const hasCompatibleMarker = includesAny(keyword, GUN_COMPATIBLE_MARKERS);
    const genericCleaner = keyword.includes("청소기") || keyword.includes("물기제거");
    if (genericCleaner && !hasCompatibleMarker) {
      reasons.push("분사/세척형 건이 아닌 별도 청소기·제거기 제품군으로 의미가 이탈함");
      matchedTerms.push("청소기/제거기");
    }
  }

  return {
    blocked: reasons.length > 0,
    reasons: [...new Set(reasons)],
    matchedTerms: [...new Set(matchedTerms)],
  };
}
