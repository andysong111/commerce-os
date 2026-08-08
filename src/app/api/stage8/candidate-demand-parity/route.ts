import {
  createCandidateDemandParityRequest,
  loadCandidateDemandParityStatus,
  runCandidateDemandParityStep,
} from "@/lib/stage8CandidateDemandParity";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request) {
  return isSameOriginOpsRequest(request);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { ok: false, code: "CANDIDATE_DEMAND_PARITY_UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    return Response.json(
      { ok: true, status: await loadCandidateDemandParityStatus() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "CANDIDATE_DEMAND_PARITY_STATUS_FAILED",
        message:
          error instanceof Error ? error.message : "후보 판매수요 비교 상태 조회 실패",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { ok: false, code: "CANDIDATE_DEMAND_PARITY_UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    const action = String(body.action ?? "start").trim();
    if (action === "run-next") {
      return Response.json(
        { ok: true, result: await runCandidateDemandParityStep() },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const current = await loadCandidateDemandParityStatus();
    if (current.state === "QUEUED" || current.state === "RUNNING") {
      return Response.json(
        {
          ok: true,
          accepted: false,
          alreadyActive: true,
          status: current,
          message: "기존 쓰기 전 후보 판매수요 비교를 먼저 완료합니다.",
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const created = await createCandidateDemandParityRequest();
    return Response.json(
      {
        ok: true,
        accepted: true,
        requestId: created.requestId,
        candidateSalesRequestId: created.candidateSalesRequestId,
        analysisAsOf: created.analysisAsOf,
        totalRanges: created.ranges.length,
        candidatePlanFingerprint: created.candidatePlanFingerprint,
        message: "Product Master 쓰기 전 canonical 후보 판매수요 비교를 접수했습니다.",
      },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "CANDIDATE_DEMAND_PARITY_ACTION_FAILED",
        message:
          error instanceof Error ? error.message : "후보 판매수요 비교 실행 실패",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
