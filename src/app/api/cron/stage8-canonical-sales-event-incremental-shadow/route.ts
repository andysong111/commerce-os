import {
  canonicalSalesEventIncrementalShadowConfigured,
  ensureCanonicalSalesEventIncrementalShadowRequest,
  runCanonicalSalesEventIncrementalShadowStep,
} from "@/lib/canonicalSalesEventIncrementalShadow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_STEPS_PER_INVOCATION = 3;
const EXTRA_STEP_START_BUDGET_MS = 20_000;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.trim();
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

async function runBoundedBurst() {
  const startedAt = Date.now();
  let stepCount = 0;
  let result = await runCanonicalSalesEventIncrementalShadowStep();
  stepCount += 1;
  while (
    stepCount < MAX_STEPS_PER_INVOCATION &&
    result.processed === true &&
    result.state === "RUNNING" &&
    Date.now() - startedAt < EXTRA_STEP_START_BUDGET_MS
  ) {
    result = await runCanonicalSalesEventIncrementalShadowStep();
    stepCount += 1;
  }
  return {
    ...result,
    stepCount,
    burstElapsedMs: Date.now() - startedAt,
    writesEnabled: false,
  };
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!canonicalSalesEventIncrementalShadowConfigured()) {
    return Response.json({
      ok: true,
      configured: false,
      processed: false,
      state: "IDLE",
      writesEnabled: false,
      message: "Exact-event incremental shadow 환경설정이 준비되지 않았습니다.",
    });
  }
  try {
    const ensured = await ensureCanonicalSalesEventIncrementalShadowRequest();
    if (["IDLE", "FAILED"].includes(ensured.state)) {
      return Response.json({
        ok: true,
        configured: true,
        processed: false,
        writesEnabled: false,
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
        writesEnabled: false,
        code: "CANONICAL_EVENT_INCREMENTAL_SHADOW_CRON_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Exact-event incremental shadow Worker 실행에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}
