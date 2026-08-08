import {
  canonicalDemandParityConfigured,
  createCanonicalDemandParityRequest,
  loadCanonicalDemandParityStatus,
  runCanonicalDemandParityStep,
} from "@/lib/stage8CanonicalDemandParity";
import {
  createDemandMismatchEvidenceRequest,
  loadDemandMismatchEvidenceStatus,
  runDemandMismatchEvidenceStep,
} from "@/lib/stage8DemandMismatchEvidence";

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

async function continueMismatchEvidence() {
  const evidence = await loadDemandMismatchEvidenceStatus();
  if (evidence.state === "IDLE") {
    try {
      const created = await createDemandMismatchEvidenceRequest();
      return {
        processed: true,
        evidenceState: "QUEUED" as const,
        evidenceRequestId: created.requestId,
        evidenceTargetCount: created.targetBarcodes.length,
        evidenceTotalRanges: created.ranges.length,
        message:
          "Parity MISMATCH를 실제 Shopling 주문행 resolver 차이 evidence로 자동 전환했습니다.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      if (message.includes("DEMAND_MISMATCH_EVIDENCE_PLANNING_CHANGED_RERUN_PARITY")) {
        const rerun = await createCanonicalDemandParityRequest();
        return {
          processed: true,
          evidenceState: "PARITY_REQUEUED" as const,
          parityRequestId: rerun.requestId,
          message:
            "상품마스터 기준정보가 parity 이후 변경되어 오래된 차이를 분석하지 않고, 현재 기준으로 parity를 자동 재접수했습니다.",
        };
      }
      throw error;
    }
  }
  if (evidence.state === "QUEUED" || evidence.state === "RUNNING") {
    const result = await runDemandMismatchEvidenceStep();
    return {
      processed: result.processed,
      evidenceState: result.state,
      evidenceRequestId: evidence.requestId,
      result,
      message:
        result.state === "COMPLETE"
          ? "Parity 차이 주문행 evidence 분류가 완료되었습니다."
          : "Parity 차이 주문행 evidence를 읽기 전용으로 이어서 수집했습니다.",
    };
  }
  return {
    processed: false,
    evidenceState: evidence.state,
    evidenceRequestId: evidence.requestId,
    report: evidence.report,
    message: evidence.message,
  };
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
    if (current.state === "MISMATCH") {
      return Response.json({
        ok: true,
        configured: true,
        state: current.state,
        blockerCount: current.blockerCount,
        parityReport: current.report,
        evidence: await continueMismatchEvidence(),
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
