import {
  createCanonicalDemandParityRequest,
  loadCanonicalDemandParityStatus,
  runCanonicalDemandParityStep,
} from "@/lib/stage8CanonicalDemandParity";
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
      { ok: false, code: "CANONICAL_DEMAND_PARITY_UNAUTHORIZED" },
      { status: 401 },
    );
  }
  try {
    return Response.json(
      { ok: true, status: await loadCanonicalDemandParityStatus() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "CANONICAL_DEMAND_PARITY_STATUS_FAILED",
        message:
          error instanceof Error ? error.message : "Canonical demand parity 조회 실패",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { ok: false, code: "CANONICAL_DEMAND_PARITY_UNAUTHORIZED" },
      { status: 401 },
    );
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    const action = String(body.action ?? "start").trim();
    if (action === "run-next") {
      return Response.json(
        { ok: true, result: await runCanonicalDemandParityStep() },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const current = await loadCanonicalDemandParityStatus();
    if (current.state === "QUEUED" || current.state === "RUNNING") {
      return Response.json({
        ok: true,
        accepted: false,
        alreadyActive: true,
        status: current,
        message: "기존 동일시점 수요 비교를 먼저 완료합니다.",
      });
    }
    const created = await createCanonicalDemandParityRequest();
    return Response.json(
      {
        ok: true,
        accepted: true,
        requestId: created.requestId,
        analysisAsOf: created.analysisAsOf,
        totalRanges: created.ranges.length,
        message:
          "Canonical 판매수요와 동일 분석시점 Shopling 직접집계 비교를 새로 접수했습니다.",
      },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "CANONICAL_DEMAND_PARITY_ACTION_FAILED",
        message:
          error instanceof Error ? error.message : "Canonical demand parity 실행 실패",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
