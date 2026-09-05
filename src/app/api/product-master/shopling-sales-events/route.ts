import {
  applyProductMasterShoplingSalesEvents,
  createProductMasterShoplingSalesEventSyncRequest,
  loadProductMasterShoplingSalesEventSyncStatus,
  runProductMasterShoplingSalesEventSyncStep,
} from "@/lib/productMasterShoplingSalesEventSync";
import { recoverProductMasterShoplingSalesEventRequest } from "@/lib/productMasterShoplingSalesEventRecovery";
import { loadCandidatePromotionGate } from "@/lib/stage8CandidatePromotionGate";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { wakeOpsDispatchTask } from "@/lib/opsAdaptiveDispatcher";

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
          { status: 400, headers: { "cache-control": "no-store" } },
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
          { status: 400, headers: { "cache-control": "no-store" } },
        );
      }

      const promotionGate = await loadCandidatePromotionGate();
      if (
        !promotionGate.safeToApply ||
        promotionGate.candidatePlanFingerprint !== planFingerprint ||
        !promotionGate.promotionFingerprint
      ) {
        return Response.json(
          {
            ok: false,
            code: "SALES_EVENT_PREWRITE_PROMOTION_GATE_BLOCKED",
            message: promotionGate.message,
            promotionGate,
          },
          { status: 409, headers: { "cache-control": "no-store" } },
        );
      }

      const result = await applyProductMasterShoplingSalesEvents(
        action,
        planFingerprint,
      );
      return Response.json(
        {
          ok: result.ok,
          result,
          promotionGate: {
            state: promotionGate.state,
            promotionFingerprint: promotionGate.promotionFingerprint,
            candidateParityFingerprint:
              promotionGate.candidateParityFingerprint,
            evidenceFingerprint: promotionGate.evidenceFingerprint,
          },
        },
        {
          status: result.ok ? 200 : 409,
          headers: { "cache-control": "no-store" },
        },
      );
    }

    const current = await loadProductMasterShoplingSalesEventSyncStatus();
    if (current.state === "FAILED") {
      const recovered = await recoverProductMasterShoplingSalesEventRequest();
      const wakeRequested = recovered.recovered
        ? await wakeOpsDispatchTask("product-master-shopling-sales-events", 0)
        : false;
      return Response.json(
        {
          ...recovered,
          ok: recovered.recovered,
          accepted: recovered.recovered,
          wakeRequested,
          message: recovered.recovered
            ? "실패한 판매 이벤트 읽기를 같은 분석시점으로 더 작은 조회구간에 안전 재접수하고 worker를 깨웠습니다."
            : "판매 이벤트 자동 축소 재시도 한도를 소진했습니다. 외부 쓰기는 차단된 상태입니다.",
        },
        {
          status: recovered.recovered ? 202 : 409,
          headers: { "cache-control": "no-store" },
        },
      );
    }
    if (
      [
        "QUEUED",
        "RUNNING",
        "READY_CANARY",
        "READY_FULL",
        "STORAGE_NOT_READY",
      ].includes(current.state)
    ) {
      const wakeRequested = await wakeOpsDispatchTask(
        "product-master-shopling-sales-events",
        0,
      );
      return Response.json(
        {
          ok: true,
          accepted: false,
          alreadyActive: true,
          wakeRequested,
          status: current,
          message: "기존 판매 이벤트 작업을 먼저 이어서 완료합니다.",
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const created = await createProductMasterShoplingSalesEventSyncRequest();
    const wakeRequested = await wakeOpsDispatchTask(
      "product-master-shopling-sales-events",
      0,
    );
    return Response.json(
      {
        ok: true,
        accepted: true,
        requestId: created.requestId,
        totalRanges: created.ranges.length,
        wakeRequested,
        message: "최근 360일 주문행 판매 이벤트 수집을 접수하고 worker를 즉시 깨웠습니다.",
      },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SALES_EVENT_SYNC_ACTION_FAILED",
        message:
          error instanceof Error ? error.message : "판매 이벤트 작업 실행 실패",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
