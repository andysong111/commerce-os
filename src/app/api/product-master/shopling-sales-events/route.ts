import {
  applyProductMasterShoplingSalesEvents,
  createProductMasterShoplingSalesEventSyncRequest,
  loadProductMasterShoplingSalesEventSyncStatus,
  runProductMasterShoplingSalesEventSyncStep,
} from "@/lib/productMasterShoplingSalesEventSync";
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
      { ok: false, code: "SALES_EVENT_SYNC_UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    return Response.json(
      { ok: true, status: await loadProductMasterShoplingSalesEventSyncStatus() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SALES_EVENT_SYNC_STATUS_FAILED",
        message: error instanceof Error ? error.message : "판매 이벤트 상태 조회 실패",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { ok: false, code: "SALES_EVENT_SYNC_UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      planFingerprint?: unknown;
      confirmation?: unknown;
    };
    const action = String(body.action ?? "start").trim();
    if (action === "run-next") {
      return Response.json(
        { ok: true, result: await runProductMasterShoplingSalesEventSyncStep() },
        { headers: { "cache-control": "no-store" } },
      );
    }
    if (action === "canary" || action === "full") {
      const planFingerprint = String(body.planFingerprint ?? "").trim();
      if (!/^sha256:[a-f0-9]{64}$/.test(planFingerprint)) {
        return Response.json(
          { ok: false, code: "SALES_EVENT_PLAN_FINGERPRINT_REQUIRED" },
          { status: 400 },
        );
      }
      const expectedConfirmation = action === "canary" ? "CANARY" : "FULL";
      if (String(body.confirmation ?? "").trim() !== expectedConfirmation) {
        return Response.json(
          {
            ok: false,
            code: "SALES_EVENT_CONFIRMATION_REQUIRED",
            message: `${expectedConfirmation} 확인이 필요합니다.`,
          },
          { status: 400 },
        );
      }
      const result = await applyProductMasterShoplingSalesEvents(
        action,
        planFingerprint,
      );
      return Response.json(
        { ok: result.ok, result },
        { status: result.ok ? 200 : 409, headers: { "cache-control": "no-store" } },
      );
    }

    const current = await loadProductMasterShoplingSalesEventSyncStatus();
    if (["QUEUED", "RUNNING", "READY_CANARY", "READY_FULL", "STORAGE_NOT_READY"].includes(current.state)) {
      return Response.json(
        {
          ok: true,
          accepted: false,
          alreadyActive: true,
          status: current,
          message: "기존 판매 이벤트 작업을 먼저 이어서 완료합니다.",
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const created = await createProductMasterShoplingSalesEventSyncRequest();
    return Response.json(
      {
        ok: true,
        accepted: true,
        requestId: created.requestId,
        totalRanges: created.ranges.length,
        message: "최근 360일 주문행 판매 이벤트 수집을 접수했습니다.",
      },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SALES_EVENT_SYNC_ACTION_FAILED",
        message: error instanceof Error ? error.message : "판매 이벤트 작업 실행 실패",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
