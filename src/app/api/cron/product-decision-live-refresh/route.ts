import {
  productDecisionLiveRefreshConfigured,
  runProductDecisionLiveRefreshStep,
} from "@/lib/productDecisionLiveRefresh";
import { recoverLegacyShoplingFetchFailure } from "@/lib/productDecisionLiveRecovery";
import { runReliabilityImpactEvaluator } from "@/lib/reliability/reliabilityImpactEvaluator";
import { runReliabilityLearningAnalyzer } from "@/lib/reliability/reliabilityLearningAnalyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization")?.trim();
  return Boolean(expected && authorization === `Bearer ${expected}`);
}

async function runReliabilityLearningBestEffort() {
  try {
    return await runReliabilityLearningAnalyzer();
  } catch (error) {
    return {
      ok: false,
      configured: true,
      claimed: 0,
      succeeded: 0,
      failed: 1,
      model: null,
      message:
        error instanceof Error
          ? error.message
          : "신뢰성 학습 분석 실행에 실패했습니다.",
    };
  }
}

async function runReliabilityImpactBestEffort() {
  try {
    return await runReliabilityImpactEvaluator();
  } catch (error) {
    return {
      ok: false,
      processed: 0,
      verified: 0,
      regressed: 0,
      measuring: 0,
      message:
        error instanceof Error
          ? error.message
          : "신뢰성 개선 효과 측정에 실패했습니다.",
    };
  }
}

async function runReliabilityCycle() {
  const reliabilityLearning = await runReliabilityLearningBestEffort();
  const reliabilityImpact = await runReliabilityImpactBestEffort();
  return { reliabilityLearning, reliabilityImpact };
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { ok: false, code: "UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  if (!productDecisionLiveRefreshConfigured()) {
    const reliability = await runReliabilityCycle();
    return Response.json(
      {
        ok: true,
        configured: false,
        processed: false,
        state: "IDLE",
        ...reliability,
        message:
          "실시간 발주 계산 환경변수가 아직 준비되지 않아 발주 계산은 실행하지 않았습니다.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const recovery = await recoverLegacyShoplingFetchFailure();
    const refresh = await runProductDecisionLiveRefreshStep();
    const reliability = await runReliabilityCycle();
    return Response.json(
      {
        ok: true,
        configured: true,
        recovery,
        ...refresh,
        ...reliability,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const reliability = await runReliabilityCycle();
    return Response.json(
      {
        ok: false,
        configured: true,
        code: "PRODUCT_DECISION_LIVE_CRON_FAILED",
        ...reliability,
        message:
          error instanceof Error
            ? error.message
            : "실시간 발주 계산 Worker 실행에 실패했습니다.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
