import {
  normalizeKeywordElonText,
  uniqueKeywordElonTexts,
  type KeywordElonIdentity,
  type KeywordElonSourceDraft,
} from "@/lib/keywordEngineElonLabV2";

const TRACKER_FALLBACK_WARNING = "BULK_TRACKER_SOURCE_FALLBACK";
const CLEANING_GUN_PATTERN = /(욕실|화장실)?(청소건|세척건|스프레이건|분사건|호스건|고압건)/;
const CONFLICTING_STICK_PATTERN = /(청소봉|밀대|걸레|막대|바닥솔)/;

function isTrackerFallback(source: KeywordElonSourceDraft) {
  return (source.warnings ?? []).some((warning) =>
    normalizeKeywordElonText(warning).includes(TRACKER_FALLBACK_WARNING),
  );
}

function keepNonConflicting(values: string[]) {
  return values.filter(
    (value) => !CONFLICTING_STICK_PATTERN.test(normalizeKeywordElonText(value)),
  );
}

export function repairKeywordElonSourceIdentityV9(
  source: KeywordElonSourceDraft,
  identity: KeywordElonIdentity,
): KeywordElonIdentity {
  if (!isTrackerFallback(source)) return identity;

  const sourceTitle = normalizeKeywordElonText(source.chineseTitle);
  const match = sourceTitle.match(CLEANING_GUN_PATTERN);
  if (!match) return identity;

  const context = normalizeKeywordElonText(match[1]);
  const coreProduct = normalizeKeywordElonText(match[2]);
  if (!coreProduct) return identity;
  const identityAnchor = `${context}${coreProduct}` || coreProduct;

  const primarySeeds = uniqueKeywordElonTexts(
    [
      coreProduct,
      identityAnchor,
      ...keepNonConflicting(identity.primarySeeds ?? []).filter((value) =>
        /(건|스프레이|분사|세척|호스|고압)/.test(normalizeKeywordElonText(value)),
      ),
    ],
    8,
  );
  const conditionalSeeds = uniqueKeywordElonTexts(
    keepNonConflicting(identity.conditionalSeeds ?? []).filter((value) =>
      /(건|스프레이|분사|세척|호스|고압)/.test(normalizeKeywordElonText(value)),
    ),
    12,
  );
  const functionModifiers = uniqueKeywordElonTexts(
    [
      ...keepNonConflicting(identity.functionModifiers ?? []),
      context ? `${context} 청소용` : "",
    ],
    12,
  );

  return {
    ...identity,
    koreanProductIdentity: identityAnchor,
    coreProduct,
    identityAnchor,
    primarySeeds,
    conditionalSeeds,
    functionModifiers,
    confidence: Math.max(0.9, Number(identity.confidence) || 0),
    reasoning: `${normalizeKeywordElonText(identity.reasoning)} · V9 원문 보호: ${identityAnchor}의 '건'을 분사/세척형 제품명사로 보존하고 청소봉·밀대·걸레 분기를 제거했습니다.`.slice(0, 500),
  };
}
