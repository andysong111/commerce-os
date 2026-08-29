import type {
  KeywordElonCandidate,
  KeywordElonIdentity,
} from "@/lib/keywordEngineElonLabV2";
import {
  filterKeywordElonProhibitedKeywords as filterKeywordElonProhibitedKeywordsBase,
  keywordElonKiprisConfigured,
  type KeywordElonStep4Decision,
  type KeywordElonStep4FilterResult,
  type KeywordElonStep4RiskCategory,
  type KeywordElonStep4TrademarkMatch,
} from "./keywordEngineElonLabV2Step4.ts";
import { evaluateKeywordElonIdentityConsistencyV10 } from "./keywordEngineElonIdentityConsistencyV10.ts";

export { keywordElonKiprisConfigured };
export type {
  KeywordElonStep4Decision,
  KeywordElonStep4FilterResult,
  KeywordElonStep4RiskCategory,
  KeywordElonStep4TrademarkMatch,
};

function applyIdentityConsistency(
  identity: KeywordElonIdentity,
  decision: KeywordElonStep4Decision,
) {
  if (decision.blocked) return false;
  const consistency = evaluateKeywordElonIdentityConsistencyV10({
    identity,
    keyword: decision.keyword,
  });
  if (!consistency.blocked) return false;

  decision.blocked = true;
  decision.reasons = [
    ...new Set([
      ...(decision.reasons ?? []),
      ...consistency.reasons.map((reason) => `상품 정체성 불일치 · ${reason}`),
    ]),
  ];
  decision.matchedTerms = [
    ...new Set([...(decision.matchedTerms ?? []), ...consistency.matchedTerms]),
  ];
  return true;
}

export async function filterKeywordElonProhibitedKeywords(input: {
  identity: KeywordElonIdentity;
  candidates: KeywordElonCandidate[];
  customBlockedTerms: string[];
}): Promise<KeywordElonStep4FilterResult> {
  const result = await filterKeywordElonProhibitedKeywordsBase(input);
  let consistencyBlocked = 0;
  for (const decision of result.decisions) {
    if (applyIdentityConsistency(input.identity, decision)) consistencyBlocked += 1;
  }

  if (!consistencyBlocked) return result;

  const allowedKeys = result.decisions
    .filter((decision) => !decision.blocked)
    .map((decision) => decision.searchKey);
  const removedKeys = result.decisions
    .filter((decision) => decision.blocked)
    .map((decision) => decision.searchKey);
  return {
    ...result,
    allowedCount: allowedKeys.length,
    removedCount: removedKeys.length,
    allowedKeys,
    removedKeys,
    warnings: [
      ...new Set([
        ...(result.warnings ?? []),
        `STEP4_IDENTITY_CONSISTENCY_BLOCKED:${consistencyBlocked}`,
      ]),
    ].slice(0, 30),
  };
}
