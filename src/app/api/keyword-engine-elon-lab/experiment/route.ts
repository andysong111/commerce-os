import { NextRequest, NextResponse } from "next/server";

import {
  getKeywordElonExperimentFixture,
  keywordElonExperimentFixtureSourceReady,
} from "@/lib/keywordEngineElonLabExperimentFixtures";
import {
  runKeywordElonThresholdExperiment,
  type KeywordElonThresholdExperimentConfig,
} from "@/lib/keywordEngineElonLabThresholdExperiment";
import { uniqueKeywordElonCanonical } from "@/lib/keywordEngineElonLabV2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 500;

const RUN_CONFIRMATION = "RUN_THRESHOLD_EXPERIMENT";

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function numberList(raw: string | null, fallback: number[], limit = 4) {
  if (!raw?.trim()) return fallback;
  const parsed = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite)
    .map(clampScore);
  const normalized = [...new Set(parsed)].slice(0, limit).sort((a, b) => a - b);
  return normalized.length ? normalized : fallback;
}

function integerParam(raw: string | null, fallback: number, min: number, max: number) {
  if (!raw?.trim()) return fallback;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function buildConfig(searchParams: URLSearchParams): KeywordElonThresholdExperimentConfig {
  return {
    step2Cutoffs: numberList(searchParams.get("step2"), [60, 65, 70], 4),
    demandQualityThresholds: numberList(searchParams.get("demand"), [55, 60, 65], 4),
    accuracyRelevanceThresholds: numberList(searchParams.get("accuracy"), [85, 90, 95], 4),
    step3Rounds: integerParam(searchParams.get("rounds"), 3, 1, 3),
    branchConcurrency: integerParam(searchParams.get("concurrency"), 2, 1, 3),
    customBlockedTerms: uniqueKeywordElonCanonical(
      (searchParams.get("blocked") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
      120,
    ),
  };
}

function experimentRuntimeAllowed() {
  return process.env.VERCEL_ENV === "preview"
    || process.env.NODE_ENV !== "production"
    || process.env.KEYWORD_THRESHOLD_EXPERIMENT_LOCAL_RUN === "1";
}

export async function GET(request: NextRequest) {
  if (!experimentRuntimeAllowed()) {
    return NextResponse.json(
      { ok: false, error: "EXPERIMENT_PREVIEW_ONLY" },
      { status: 404 },
    );
  }

  const sampleId = request.nextUrl.searchParams.get("sample")?.trim() || "nose-tape-step1-v1";
  const fixture = getKeywordElonExperimentFixture(sampleId);
  if (!fixture) {
    return NextResponse.json(
      { ok: false, error: "EXPERIMENT_SAMPLE_NOT_FOUND", sampleId },
      { status: 404 },
    );
  }

  const config = buildConfig(request.nextUrl.searchParams);
  const sourceReady = keywordElonExperimentFixtureSourceReady(fixture);
  const plan = {
    sampleId: fixture.id,
    sampleLabel: fixture.label,
    sourceReady,
    sourceMode: fixture.sourceMode,
    config,
    combinationCount: config.step2Cutoffs.length
      * config.demandQualityThresholds.length
      * config.accuracyRelevanceThresholds.length,
    costControl: {
      step2DiscoveryAndScoring: "샘플당 1회 공유",
      step3: "STEP 2 cutoff별 branch만 실제 재실행",
      step4: "각 branch의 broad pool을 1회 검사 후 모든 최종 기준 조합에 재사용",
      step5: "실제 수집 후보 기반 observed 보조풀만 비교 · 추가 생성 버튼은 실험 표준화에서 제외",
    },
  };

  if (request.nextUrl.searchParams.get("mode") !== "run") {
    return NextResponse.json({
      ok: true,
      mode: "plan",
      plan,
      fixture: {
        id: fixture.id,
        label: fixture.label,
        sourceMode: fixture.sourceMode,
        identity: fixture.identity,
        source: fixture.source,
        notes: fixture.notes,
      },
      runInstruction: sourceReady
        ? `mode=run&confirm=${RUN_CONFIRMATION} 를 추가하면 실제 실험을 시작합니다.`
        : "fixture의 STEP 1 고정 입력을 다시 확인해야 합니다.",
    });
  }

  if (!sourceReady) {
    return NextResponse.json({
      ok: false,
      error: "EXPERIMENT_SOURCE_INCOMPLETE",
      plan,
      message: "실험 fixture에 상품 정체성·Primary Seed·실험용 source 정보가 부족합니다.",
    }, { status: 422 });
  }

  if (request.nextUrl.searchParams.get("confirm") !== RUN_CONFIRMATION) {
    return NextResponse.json({
      ok: false,
      error: "EXPERIMENT_CONFIRMATION_REQUIRED",
      plan,
      requiredConfirm: RUN_CONFIRMATION,
    }, { status: 400 });
  }

  const result = await runKeywordElonThresholdExperiment({
    source: fixture.source,
    identity: fixture.identity,
    config,
  });

  return NextResponse.json({
    ok: true,
    mode: "run",
    sampleId: fixture.id,
    sampleLabel: fixture.label,
    sourceMode: fixture.sourceMode,
    result,
  });
}
