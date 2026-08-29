import type {
  KeywordElonIdentity,
  KeywordElonSourceDraft,
} from "@/lib/keywordEngineElonLabV2";
import {
  analyzeKeywordElonIdentity as analyzeKeywordElonIdentityBase,
  collectKeywordElon1688Source,
  generateKeywordElonTitle,
} from "./keywordEngineElonLabV2Server.ts";
import { repairKeywordElonSourceIdentityV9 } from "./keywordEngineElonSourceIdentityGuardV9.ts";

export { collectKeywordElon1688Source, generateKeywordElonTitle };

export async function analyzeKeywordElonIdentity(
  source: KeywordElonSourceDraft,
): Promise<KeywordElonIdentity> {
  const identity = await analyzeKeywordElonIdentityBase(source);
  return repairKeywordElonSourceIdentityV9(source, identity);
}
