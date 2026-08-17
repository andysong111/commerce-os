import { NextRequest, NextResponse } from "next/server";

import type { KeywordElonCandidate, KeywordElonDiscovery, KeywordElonIdentity, KeywordElonSourceDraft } from "@/lib/keywordEngineElonLabV2";
import { analyzeKeywordElonIdentity, collectKeywordElon1688Source, discoverKeywordElonCandidates, generateKeywordElonTitle, scoreKeywordElonCandidates } from "@/lib/keywordEngineElonLabV2Server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function sourceFrom(value: unknown): KeywordElonSourceDraft {
  if (!isRecord(value)) throw new Error("source 입력이 없습니다.");
  return {
    url: text(value.url), offerId: text(value.offerId),
    autoStatus: value.autoStatus === "success" || value.autoStatus === "partial" || value.autoStatus === "failed" ? value.autoStatus : "idle",
    chineseTitle: text(value.chineseTitle), optionText: text(value.optionText), supportingText: text(value.supportingText),
    warnings: Array.isArray(value.warnings) ? value.warnings.map(text).filter(Boolean).slice(0, 20) : [], collectedAt: text(value.collectedAt),
  };
}
function identityFrom(value: unknown): KeywordElonIdentity {
  if (!isRecord(value)) throw new Error("identity 입력이 없습니다.");
  const strings = (key: string) => Array.isArray(value[key]) ? (value[key] as unknown[]).map(text).filter(Boolean).slice(0, 20) : [];
  return {
    koreanProductIdentity: text(value.koreanProductIdentity), coreProduct: text(value.coreProduct), identityAnchor: text(value.identityAnchor),
    primarySeeds: strings("primarySeeds"), conditionalSeeds: strings("conditionalSeeds"), functionModifiers: strings("functionModifiers"),
    designShapeModifiers: strings("designShapeModifiers"), specAttributes: strings("specAttributes"), variantNoise: strings("variantNoise"),
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)), reasoning: text(value.reasoning), model: text(value.model),
  };
}
function discoveryFrom(value: unknown): KeywordElonDiscovery {
  if (!isRecord(value)) throw new Error("discovery 입력이 없습니다.");
  return value as unknown as KeywordElonDiscovery;
}
function candidatesFrom(value: unknown): KeywordElonCandidate[] {
  if (!Array.isArray(value)) throw new Error("candidates 입력이 없습니다.");
  return value.filter(isRecord) as unknown as KeywordElonCandidate[];
}
function readiness() {
  return {
    openAiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    searchAdConfigured: Boolean(process.env.NAVER_SEARCHAD_API_KEY?.trim() && process.env.NAVER_SEARCHAD_SECRET_KEY?.trim() && process.env.NAVER_SEARCHAD_CUSTOMER_ID?.trim()),
  };
}

export async function GET() { return NextResponse.json({ ok: true, version: 2, ...readiness() }); }

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new Error("요청 본문이 올바르지 않습니다.");
    const action = text(body.action);
    if (action === "collect_source") {
      const url = text(body.url); if (!url) throw new Error("1688 링크를 입력해 주세요.");
      return NextResponse.json({ ok: true, action, source: await collectKeywordElon1688Source(url) });
    }
    if (action === "analyze_identity") {
      return NextResponse.json({ ok: true, action, identity: await analyzeKeywordElonIdentity(sourceFrom(body.source)) });
    }
    if (action === "discover_keywords") {
      const source = sourceFrom(body.source); const identity = identityFrom(body.identity);
      return NextResponse.json({ ok: true, action, discovery: await discoverKeywordElonCandidates(source, identity) });
    }
    if (action === "score_keywords") {
      const result = await scoreKeywordElonCandidates({ source: sourceFrom(body.source), identity: identityFrom(body.identity), discovery: discoveryFrom(body.discovery) });
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "generate_title") {
      const cutoff = Math.max(0, Math.min(100, Number(body.cutoff) || 70));
      const titleResult = await generateKeywordElonTitle({ source: sourceFrom(body.source), identity: identityFrom(body.identity), candidates: candidatesFrom(body.candidates), cutoff });
      return NextResponse.json({ ok: true, action, titleResult });
    }
    return NextResponse.json({ ok: false, error: `지원하지 않는 action: ${action || "(없음)"}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "키워드 실험실 처리 실패" }, { status: 500 });
  }
}
