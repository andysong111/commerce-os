import {
  createProductMasterShoplingSalesEventSyncRequest,
  loadProductMasterShoplingSalesEventSyncStatus,
  productMasterShoplingSalesEventSyncConfigured,
  runProductMasterShoplingSalesEventSyncStep,
} from "@/lib/productMasterShoplingSalesEventSync";

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
  let result = await runProductMasterShoplingSalesEventSyncStep();
  stepCount += 1;
  while (
    stepCount < MAX_STEPS_PER_INVOCATION &&
    result.processed === true &&
    result.state === "RUNNING" &&
    Date.now() - startedAt < EXTRA_STEP_START_BUDGET_MS
  ) {
    result = await runProductMasterShoplingSalesEventSyncStep();
    stepCount += 1;
  }
  return { ...result, stepCount, burstElapsedMs: Date.now() - startedAt };
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!productMasterShoplingSalesEventSyncConfigured()) {
    return Response.json({
      ok: true,
      configured: false,
      processed: false,
      state: "IDLE",
      message: "판매 이벤트 연동 환경설정이 준비되지 않았습니다.",
    });
  }
  try {
    const current = await loadProductMasterShoplingSalesEventSyncStatus();
    if (current.state === "IDLE") {
      const created = await createProductMasterShoplingSalesEventSyncRequest();
      return Response.json({
        ok: true,
        configured: true,
        processed: true,
        state: "QUEUED",
        requestId: created.requestId,
        totalRanges: created.ranges.length,
        message: "최근 360일 정확한 주문행 판매 이벤트 수집을 자동 접수했습니다.",
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
      planFingerprint: current.report?.planFingerprint ?? null,
      blockerCount: current.blockerCount,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        configured: true,
        code: "SALES_EVENT_CRON_FAILED",
        message: error instanceof Error ? error.message : "판매 이벤트 Worker 실행 실패",
      },
      { status: 500 },
    );
  }
}
