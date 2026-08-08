import {
  createCandidateMismatchEvidenceRequest,
  loadCandidateMismatchEvidenceStatus,
  runCandidateMismatchEvidenceStep,
} from "@/lib/stage8CandidateMismatchEvidence";
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
      { ok: false, code: "CANDIDATE_MISMATCH_EVIDENCE_UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    return Response.json(
      { ok: true, status: await loadCandidateMismatchEvidenceStatus() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "CANDIDATE_MISMATCH_EVIDENCE_STATUS_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Candidate mismatch evidence 상태 조회 실패",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { ok: false, code: "CANDIDATE_MISMATCH_EVIDENCE_UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    const action = String(body.action ?? "start").trim();
    if (action === "run-next") {
      return Response.json(
        { ok: true, result: await runCandidateMismatchEvidenceStep() },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const current = await loadCandidateMismatchEvidenceStatus();
    if (current.state === "QUEUED" || current.state === "RUNNING") {
      return Response.json(
        {
          ok: true,
          accepted: false,
          alreadyActive: true,
          status: current,
          message: "기존 candidate mismatch evidence를 먼저 완료합니다.",
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const created = await createCandidateMismatchEvidenceRequest();
    return Response.json(
      {
        ok: true,
        accepted: true,
        requestId: created.requestId,
        candidateSalesRequestId: created.candidateSalesRequestId,
        candidateParityRequestId: created.candidateParityRequestId,
        analysisAsOf: created.analysisAsOf,
        targetBarcodes: created.targetBarcodes,
        totalRanges: created.ranges.length,
        candidateParityFingerprint: created.candidateParityFingerprint,
        message: "쓰기 전 candidate parity 차이 원주문행 evidence를 접수했습니다.",
      },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "CANDIDATE_MISMATCH_EVIDENCE_ACTION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Candidate mismatch evidence 실행 실패",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
