import {
  createProductDecisionLiveRefreshRequest,
  loadProductDecisionLiveStatus,
  runProductDecisionLiveRefreshStep,
} from "@/lib/productDecisionLiveRefresh";
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
      {
        ok: false,
        code: "PRODUCT_DECISION_LIVE_UNAUTHORIZED",
        message: "실시간 발주 계산 상태를 조회할 권한이 필요합니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const requestId = new URL(request.url).searchParams.get("requestId");
    return Response.json(
      { ok: true, status: await loadProductDecisionLiveStatus(requestId) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_DECISION_LIVE_STATUS_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "실시간 발주 계산 상태를 불러오지 못했습니다.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_DECISION_LIVE_UNAUTHORIZED",
        message: "실시간 발주 계산을 실행할 권한이 필요합니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
    };
    if (String(body.action ?? "").trim() === "run-next") {
      return Response.json(
        { ok: true, result: await runProductDecisionLiveRefreshStep() },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const current = await loadProductDecisionLiveStatus();
    if (current.state === "QUEUED" || current.state === "RUNNING") {
      return Response.json(
        {
          ok: true,
          accepted: false,
          alreadyActive: true,
          status: current,
          message: "이미 실시간 판매 발주 계산이 진행 중입니다.",
        },
        { status: 200, headers: { "cache-control": "no-store" } },
      );
    }
    const created = await createProductDecisionLiveRefreshRequest();
    return Response.json(
      {
        ok: true,
        accepted: true,
        requestId: created.requestId,
        message:
          "실시간 판매 발주 계산을 접수했습니다. 예약 Worker가 주문과 클레임을 구간별로 처리합니다.",
      },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "실시간 판매 발주 계산을 시작하지 못했습니다.";
    const configurationError =
      /CREDENTIAL|PRODUCT_MASTER|SUPABASE_ADMIN/.test(message);
    return Response.json(
      {
        ok: false,
        code: configurationError
          ? "PRODUCT_DECISION_LIVE_NOT_CONFIGURED"
          : "PRODUCT_DECISION_LIVE_REQUEST_FAILED",
        message,
      },
      {
        status: configurationError ? 503 : 500,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
