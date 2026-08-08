import {
  canonicalDemandParityConfigured,
  createCanonicalDemandParityRequest,
  loadCanonicalDemandParityStatus,
  runCanonicalDemandParityStep,
} from "@/lib/stage8CanonicalDemandParity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_STEPS_PER_INVOCATION = 3;
const EXTRA_STEP_START_BUDGET_MS = 12_000;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.trim();
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

async function runBoundedBurst() {
  const startedAt = Date.now();
  let stepCount = 0;
  let result = await runCanonicalDemandParityStep();
  stepCount += 1;
  while (
    stepCount < MAX_STEPS_PER_INVOCATION &&
    result.processed === true &&
    result.state === "RUNNING" &&
    Date.now() - startedAt < EXTRA_STEP_START_BUDGET_MS
  ) {
    result = await runCanonicalDemandParityStep();
    stepCount += 1;
  }
  return { ...result, stepCount, burstElapsedMs: Date.now() - startedAt };
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!canonicalDemandParityConfigured()) {
    return Response.json({
      ok: true,
      configured: false,
      processed: false,
      state: "IDLE",
      message: "Canonical demand parity 환경설정이 준비되지 않았습니다.",
    });
  }
  try {
    const current = await loadCanonicalDemandParityStatus();
    if (current.state === "IDLE") {
      const created = await createCanonicalDemandParityRequest();
      return Response.json({
        ok: true,
        configured: true,
        processed: true,
        state: "QUEUED",
        requestId: created.requestId,
        totalRanges: created.ranges.length,
        analysisAsOf: created.analysisAsOf,
        message:
          "Canonical 판매원장과 같은 분석시점의 Shopling 직접 주문 집계를 읽기 전용으로 자동 접수했습니다.",
      });
    }
    if (current.state === "QUEUED" || current.state === "RUNNING") {
      return Response.json({
        ok: true,
        configured: true,
        ...(await runBoundedBurst()),
      });
    }
    return Response.json({
      ok: true,
      configured: true,
      processed: false,
      state: current.state,
      message: current.message,
      blockerCount: current.blockerCount,
      report: current.report,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        configured: true,
        code: "CANONICAL_DEMAND_PARITY_CRON_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Canonical demand parity Worker 실행 실패",
      },
      { status: 500 },
    );
  }
}
