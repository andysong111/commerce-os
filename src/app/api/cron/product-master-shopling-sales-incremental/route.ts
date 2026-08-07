import {
  ensureProductMasterShoplingSalesIncrementalRequest,
  productMasterShoplingSalesIncrementalConfigured,
  runProductMasterShoplingSalesIncrementalStep,
} from "@/lib/productMasterShoplingSalesIncremental";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_STEPS_PER_INVOCATION = 6;
const EXTRA_STEP_START_BUDGET_MS = 10_000;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.trim();
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

async function runBoundedBurst() {
  const startedAt = Date.now();
  let stepCount = 0;
  let result = await runProductMasterShoplingSalesIncrementalStep();
  stepCount += 1;

  while (
    stepCount < MAX_STEPS_PER_INVOCATION &&
    result.processed === true &&
    result.state === "RUNNING" &&
    Date.now() - startedAt < EXTRA_STEP_START_BUDGET_MS
  ) {
    result = await runProductMasterShoplingSalesIncrementalStep();
    stepCount += 1;
  }

  return {
    ...result,
    stepCount,
    burstElapsedMs: Date.now() - startedAt,
  };
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!productMasterShoplingSalesIncrementalConfigured()) {
    return Response.json({
      ok: true,
      configured: false,
      processed: false,
      state: "IDLE",
      message: "Shopling 판매원장 증분 환경설정이 준비되지 않았습니다.",
    });
  }

  try {
    const ensured = await ensureProductMasterShoplingSalesIncrementalRequest();
    if (ensured.state === "WAITING_BASELINE") {
      return Response.json({
        ok: true,
        configured: true,
        processed: false,
        ...ensured,
      });
    }
    if (ensured.state === "IDLE" || ensured.state === "FAILED") {
      return Response.json({
        ok: true,
        configured: true,
        processed: false,
        ...ensured,
      });
    }

    return Response.json({
      ok: true,
      configured: true,
      request: ensured,
      ...(await runBoundedBurst()),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        configured: true,
        code: "PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_CRON_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Shopling 판매원장 증분 Worker 실행에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}
