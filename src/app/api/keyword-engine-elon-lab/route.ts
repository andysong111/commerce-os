import { NextRequest, NextResponse } from "next/server";

import type { KeywordElonCandidate, KeywordElonDiscovery, KeywordElonIdentity, KeywordElonSourceDraft } from "@/lib/keywordEngineElonLabV2";
import { keywordElonApiHubConfigured } from "@/lib/keywordEngineElonLabV2ApiHub";
import { enrichKeywordElonDemand } from "@/lib/keywordEngineElonLabV2DemandEnrichment";
import { discoverKeywordElonCandidatesResilient } from "@/lib/keywordEngineElonLabV2Discovery";
import { scoreKeywordElonCandidatesBatched } from "@/lib/keywordEngineElonLabV2Scoring";
import { analyzeKeywordElonIdentity, collectKeywordElon1688Source, generateKeywordElonTitle } from "@/lib/keywordEngineElonLabV2Server";
import { expandKeywordElonFromPassing } from "@/lib/keywordEngineElonLabV2Step3";
import { filterKeywordElonProhibitedKeywords } from "@/lib/keywordEngineElonLabV2Step4";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 500;

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function textArray(value: unknown, limit = 20) {
  return Array.isArray(value) ? value.map(text).filter(Boolean).slice(0, limit) : [];
}
function sourceFrom(value: unknown): KeywordElonSourceDraft {
  if (!isRecord(value)) throw new Error("source 입력이 없습니다.");
  return {
    url: text(value.url), offerId: text(value.offerId),
    autoStatus: value.autoStatus === "success" || value.autoStatus === "partial" || value.autoStatus === "failed" ? value.autoStatus : "idle",
    chineseTitle: text(value.chineseTitle), optionText: text(value.optionText), supportingText: text(value.supportingText),
    warnings: textArray(value.warnings, 20), collectedAt: text(value.collectedAt),
  };
}
function identityFrom(value: unknown): KeywordElonIdentity {
  if (!isRecord(value)) throw new Error("identity 입력이 없습니다.");
  const strings = (key: string) => textArray(value[key], 20);
  return {
    koreanProductIdentity: text(value.koreanProductIdentity), coreProduct: text(value.coreProduct), identityAnchor: text(value.identityAnchor),
    primarySeeds: strings("primarySeeds"), conditionalSeeds: strings("conditionalSeeds"), functionModifiers: strings("functionModifiers"),
    designShapeModifiers: strings("designShapeModifiers"), specAttributes: strings("specAttributes"), variantNoise: strings("variantNoise"),
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)), reasoning: text(value.reasoning), model: text(value.model),
  };
}
function discoveryFrom(value: unknown): KeywordElonDiscovery { if (!isRecord(value)) throw new Error("discovery 입력이 없습니다."); return value as unknown as KeywordElonDiscovery; }
function candidatesFrom(value: unknown): KeywordElonCandidate[] { if (!Array.isArray(value)) throw new Error("candidates 입력이 없습니다."); return value.filter(isRecord) as unknown as KeywordElonCandidate[]; }
function readiness() {
  return {
    openAiConfigured: Boolean((process.env.KEYWORD_ENGINE_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY)?.trim()),
    searchAdConfigured: Boolean(process.env.NAVER_SEARCHAD_API_KEY?.trim() && process.env.NAVER_SEARCHAD_SECRET_KEY?.trim() && process.env.NAVER_SEARCHAD_CUSTOMER_ID?.trim()),
    apiHubConfigured: keywordElonApiHubConfigured(),
    searchTrendConfigured: keywordElonApiHubConfigured(),
    kiprisConfigured: false,
    step3ExpansionAvailable: true,
    step4FilterAvailable: true,
    oneClickToStep4Available: true,
  };
}

export async function GET() { return NextResponse.json({ ok: true, version: 6, marketRecall: "evidence-first", ...readiness() }); }
export async function POST(request: NextRequest) {
  let action = "request";
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new Error("요청 본문이 올바르지 않습니다.");
    action = text(body.action) || "request";
    if (action === "collect_source") {
      const url = text(body.url); if (!url) throw new Error("1688 링크를 입력해 주세요.");
      return NextResponse.json({ ok: true, action, source: await collectKeywordElon1688Source(url) });
    }
    if (action === "analyze_identity") return NextResponse.json({ ok: true, action, identity: await analyzeKeywordElonIdentity(sourceFrom(body.source)) });
    if (action === "discover_keywords") {
      const source = sourceFrom(body.source); const identity = identityFrom(body.identity);
      return NextResponse.json({ ok: true, action, discovery: await discoverKeywordElonCandidatesResilient(source, identity) });
    }
    if (action === "expand_from_passing") {
      const result = await expandKeywordElonFromPassing({
        identity: identityFrom(body.identity),
        seedKeywords: textArray(body.seedKeywords, 12),
        existingDiscovery: discoveryFrom(body.existingDiscovery),
        existingCandidates: candidatesFrom(body.existingCandidates),
        round: Math.max(1, Math.floor(Number(body.round) || 1)),
      });
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "score_keywords") {
      const result = await scoreKeywordElonCandidatesBatched({ source: sourceFrom(body.source), identity: identityFrom(body.identity), discovery: discoveryFrom(body.discovery) });
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "enrich_demand") {
      const result = await enrichKeywordElonDemand({ candidates: candidatesFrom(body.candidates), discovery: discoveryFrom(body.discovery) });
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "filter_prohibited_keywords") {
      const result = await filterKeywordElonProhibitedKeywords({
        identity: identityFrom(body.identity),
        candidates: candidatesFrom(body.candidates),
        customBlockedTerms: textArray(body.customBlockedTerms, 120),
      });
      return NextResponse.json({ ok: true, action, result });
    }
    if (action === "generate_title") {
      const rawCutoff = Number(body.cutoff);
      const cutoff = Math.max(0, Math.min(100, Number.isFinite(rawCutoff) ? rawCutoff : 70));
      const titleResult = await generateKeywordElonTitle({ source: sourceFrom(body.source), identity: identityFrom(body.identity), candidates: candidatesFrom(body.candidates), cutoff });
      return NextResponse.json({ ok: true, action, titleResult });
    }
    return NextResponse.json({ ok: false, errorStage: action, error: `지원하지 않는 action: ${action}` }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "키워드 실험실 처리 실패";
    console.error("[keyword-engine-elon-lab]", action, message);
    return NextResponse.json({ ok: false, errorStage: action, error: `[${action}] ${message}` }, { status: 500 });
  }
}
