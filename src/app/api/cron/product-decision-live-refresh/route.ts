import {
  productDecisionLiveRefreshConfigured,
  runProductDecisionLiveRefreshStep,
} from "@/lib/productDecisionLiveRefresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization")?.trim();
  return Boolean(expected && authorization === `Bearer ${expected}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { ok: false, code: "UNAUTHORIZED" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  if (!productDecisionLiveRefreshConfigured()) {
    return Response.json(
      {
        ok: true,
        configured: false,
        processed: false,
        state: "IDLE",
        message:
          "실시간 발주 계산 환경변수가 아직 준비되지 않아 작업을 실행하지 않았습니다.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    return Response.json(
      {
        ok: true,
        configured: true,
        ...(await runProductDecisionLiveRefreshStep()),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        configured: true,
        code: "PRODUCT_DECISION_LIVE_CRON_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "실시간 발주 계산 Worker 실행에 실패했습니다.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
