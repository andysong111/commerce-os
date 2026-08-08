import {
  canonicalSalesEventFullAuditConfigured,
  ensureCanonicalSalesEventFullAuditRequest,
  runCanonicalSalesEventFullAuditStep,
} from "@/lib/canonicalSalesEventFullAudit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_STEPS_PER_INVOCATION = 2;
const EXTRA_STEP_START_BUDGET_MS = 20_000;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.trim();
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

async function runBoundedBurst() {
  const startedAt = Date.now();
  let stepCount = 0;
  let result = await runCanonicalSalesEventFullAuditStep();
  stepCount += 1;
  while (
    stepCount < MAX_STEPS_PER_INVOCATION &&
    result.processed === true &&
    result.state === "RUNNING" &&
    Date.now() - startedAt < EXTRA_STEP_START_BUDGET_MS
  ) {
    result = await runCanonicalSalesEventFullAuditStep();
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
  if (!canonicalSalesEventFullAuditConfigured()) {
    return Response.json({
      ok: true,
      configured: false,
      state: "IDLE",
      processed: false,
      writesEnabled: false,
      message: "360일 canonical full audit 환경설정이 준비되지 않았습니다.",
    });
  }
  try {
    const ensured = await ensureCanonicalSalesEventFullAuditRequest();
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
        state: "FAILED",
        writesEnabled: false,
        code: "CANONICAL_EVENT_FULL_AUDIT_CRON_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "360일 canonical full audit Worker 실행에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}
