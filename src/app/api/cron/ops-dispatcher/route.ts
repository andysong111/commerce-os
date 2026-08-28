import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  claimNextOpsDispatchTask,
  finishOpsDispatchTask,
  invokeOpsDispatchTask,
} from "@/lib/opsAdaptiveDispatcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "OPS dispatcher failed");
}

function databasePressureFromError(error: unknown) {
  const message = errorText(error).toLowerCase();
  return [
    "supabase",
    "pgrst",
    "postgres",
    "database",
    "schema cache",
    "statement timeout",
    "could not query",
    "not accepting connections",
    "rest timeout",
  ].some((token) => message.includes(token));
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json(
      { ok: false, error: "OPS dispatcher는 Production에서만 실행됩니다." },
      { status: 403 },
    );
  }

  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET 설정이 없어 OPS dispatcher를 차단했습니다." },
      { status: 503 },
    );
  }
  if (!authorized(request, secret)) {
    return NextResponse.json(
      { ok: false, error: "OPS dispatcher 인증에 실패했습니다." },
      { status: 401 },
    );
  }

  const admin = await createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "Supabase 관리자 설정이 필요합니다." },
      { status: 503 },
    );
  }

  const workerId = `ops-dispatch:${process.env.VERCEL_REGION || "unknown"}:${randomUUID()}`;
  let claim;
  try {
    claim = await claimNextOpsDispatchTask(admin, workerId, 300);
  } catch (error) {
    console.error("[ops-dispatcher] claim failed", error);
    return NextResponse.json(
      { ok: false, error: errorText(error) },
      { status: 503 },
    );
  }

  if (!claim.claimed || !claim.task) {
    return NextResponse.json({
      ok: true,
      claimed: false,
      reason: claim.reason,
      mode: claim.mode,
      recoveryUntil: claim.recoveryUntil,
      nextDueAt: claim.nextDueAt,
    });
  }

  const task = claim.task;
  try {
    const execution = await invokeOpsDispatchTask(
      task,
      new URL(request.url).origin,
      secret,
    );
    const outcome = execution.ok ? "success" : "failure";
    const error = execution.ok
      ? ""
      : String(execution.body.error || execution.body.message || `HTTP ${execution.status}`);
    const finished = await finishOpsDispatchTask(admin, {
      workerId,
      taskKey: task.taskKey,
      outcome,
      httpStatus: execution.status,
      busy: execution.busy,
      databasePressure: execution.databasePressure,
      result: execution.compactResult,
      error,
    });

    return NextResponse.json(
      {
        ok: execution.ok,
        claimed: true,
        taskKey: task.taskKey,
        routePath: task.routePath,
        mode: claim.mode,
        busy: execution.busy,
        databasePressure: execution.databasePressure,
        status: execution.status,
        durationMs: execution.durationMs,
        finished,
      },
      { status: execution.ok ? 200 : 500 },
    );
  } catch (error) {
    const message = errorText(error);
    const databasePressure = databasePressureFromError(error);
    console.error("[ops-dispatcher] task failed", {
      taskKey: task.taskKey,
      error: message,
    });
    try {
      await finishOpsDispatchTask(admin, {
        workerId,
        taskKey: task.taskKey,
        outcome: "failure",
        httpStatus: 500,
        databasePressure,
        result: {},
        error: message,
      });
    } catch (finishError) {
      console.error("[ops-dispatcher] failed to release task lease", finishError);
    }
    return NextResponse.json(
      {
        ok: false,
        claimed: true,
        taskKey: task.taskKey,
        databasePressure,
        error: message,
      },
      { status: 500 },
    );
  }
}
