import {
  createDemandMismatchEvidenceRequest,
  loadDemandMismatchEvidenceStatus,
  runDemandMismatchEvidenceStep,
} from "@/lib/stage8DemandMismatchEvidence";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  return isSameOriginOpsRequest(request);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { ok: false, code: "DEMAND_MISMATCH_EVIDENCE_UNAUTHORIZED" },
      { status: 401 },
    );
  }
  try {
    return Response.json(
      { ok: true, status: await loadDemandMismatchEvidenceStatus() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "DEMAND_MISMATCH_EVIDENCE_STATUS_FAILED",
        message:
          error instanceof Error ? error.message : "Mismatch evidence 상태 조회 실패",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { ok: false, code: "DEMAND_MISMATCH_EVIDENCE_UNAUTHORIZED" },
      { status: 401 },
    );
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    const action = String(body.action ?? "start").trim();
    if (action === "run-next") {
      return Response.json(
        { ok: true, result: await runDemandMismatchEvidenceStep() },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const current = await loadDemandMismatchEvidenceStatus();
    if (current.state === "QUEUED" || current.state === "RUNNING") {
      return Response.json({
        ok: true,
        accepted: false,
        alreadyActive: true,
        status: current,
        message: "기존 mismatch evidence 수집을 먼저 완료합니다.",
      });
    }
    const created = await createDemandMismatchEvidenceRequest();
    return Response.json(
      {
        ok: true,
        accepted: true,
        requestId: created.requestId,
        totalRanges: created.ranges.length,
        targetBarcodes: created.targetBarcodes,
        message: "Parity 차이 원주문행 evidence 수집을 접수했습니다.",
      },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "DEMAND_MISMATCH_EVIDENCE_ACTION_FAILED",
        message:
          error instanceof Error ? error.message : "Mismatch evidence 실행 실패",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
