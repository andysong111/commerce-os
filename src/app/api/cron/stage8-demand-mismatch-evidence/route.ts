import {
  createDemandMismatchEvidenceRequest,
  demandMismatchEvidenceConfigured,
  loadDemandMismatchEvidenceStatus,
  runDemandMismatchEvidenceStep,
} from "@/lib/stage8DemandMismatchEvidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_STEPS_PER_INVOCATION = 2;
const EXTRA_STEP_START_BUDGET_MS = 10_000;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.trim();
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

async function runBoundedBurst() {
  const startedAt = Date.now();
  let stepCount = 0;
  let result = await runDemandMismatchEvidenceStep();
  stepCount += 1;
  while (
    stepCount < MAX_STEPS_PER_INVOCATION &&
    result.processed === true &&
    result.state === "RUNNING" &&
    Date.now() - startedAt < EXTRA_STEP_START_BUDGET_MS
  ) {
    result = await runDemandMismatchEvidenceStep();
    stepCount += 1;
  }
  return { ...result, stepCount, burstElapsedMs: Date.now() - startedAt };
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!demandMismatchEvidenceConfigured()) {
    return Response.json({
      ok: true,
      configured: false,
      processed: false,
      state: "IDLE",
      message: "Mismatch evidence 환경설정이 준비되지 않았습니다.",
    });
  }
  try {
    const current = await loadDemandMismatchEvidenceStatus();
    if (current.state === "IDLE") {
      const created = await createDemandMismatchEvidenceRequest();
      return Response.json({
        ok: true,
        configured: true,
        processed: true,
        state: "QUEUED",
        requestId: created.requestId,
        totalRanges: created.ranges.length,
        targetCount: created.targetBarcodes.length,
        message: "Stage8 parity 차이 원주문행 evidence 수집을 자동 접수했습니다.",
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
      report: current.report,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        configured: true,
        code: "DEMAND_MISMATCH_EVIDENCE_CRON_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Mismatch evidence Worker 실행 실패",
      },
      { status: 500 },
    );
  }
}
