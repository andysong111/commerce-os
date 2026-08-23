import { NextResponse } from "next/server";
import { planReliabilityAutoImprovement } from "@/lib/reliability/reliabilityAutoImprovementPlanner";
import {
  claimReliabilityAutoImprovementJob,
  saveReliabilityAutoImprovementPlan,
} from "@/lib/reliability/reliabilityAutoImprovementStore";
import { authorizeReliabilityGitHubRunner } from "@/lib/reliability/reliabilityGitHubOidc";
import { redactReliabilityText } from "@/lib/reliability/reliabilityEvent";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function failPlanning(input: {
  jobId: string;
  leaseToken: string;
  attemptCount: number;
  maxAttempts: number;
  error: unknown;
}) {
  const admin = await createSupabaseAdminClient();
  if (!admin) return;
  const blocked = input.attemptCount >= input.maxAttempts;
  const message = redactReliabilityText(
    input.error instanceof Error ? input.error.message : String(input.error ?? "unknown error"),
    1_500,
  );
  await admin
    .from("reliability_auto_improvement_jobs")
    .update({
      status: blocked ? "blocked" : "failed",
      not_before: new Date(Date.now() + 30 * 60_000).toISOString(),
      lease_token: null,
      lease_runner: null,
      lease_expires_at: null,
      last_error: message,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.jobId)
    .eq("lease_token", input.leaseToken);
  await admin.from("reliability_auto_improvement_activity").insert({
    job_id: input.jobId,
    event_type: "planning_failed",
    from_status: "planning",
    to_status: blocked ? "blocked" : "failed",
    summary: blocked
      ? "자동수정 계획이 반복해서 안전검사를 통과하지 못해 자동 반영을 중단했습니다."
      : "자동수정 계획이 안전검사를 통과하지 못해 실제 서비스에는 반영하지 않았습니다.",
  });
}

export async function POST(request: Request) {
  const authorization = await authorizeReliabilityGitHubRunner(request);
  if (!authorization.ok) {
    return json({ ok: false, message: authorization.message }, authorization.status);
  }

  const body = (await request.json().catch(() => ({}))) as { run_id?: unknown };
  const runner = String(body.run_id ?? authorization.identity.runId ?? "")
    .trim()
    .slice(0, 200);
  if (!runner) return json({ ok: false, message: "자동개선 실행 번호가 없습니다." }, 400);

  let job: Awaited<ReturnType<typeof claimReliabilityAutoImprovementJob>> = null;
  try {
    job = await claimReliabilityAutoImprovementJob(
      authorization.identity.repository,
      runner,
    );
    if (!job) return json({ ok: true, job: null, message: "자동으로 고칠 안전한 항목이 없습니다." });

    const plan = await planReliabilityAutoImprovement(job);
    await saveReliabilityAutoImprovementPlan({ job, plan });
    return json({
      ok: true,
      job: {
        id: job.id,
        improvement_id: job.improvement_id,
        target_repo: job.target_repo,
        safe_surface: job.safe_surface,
        allowed_paths: job.allowed_paths,
        lease_token: job.lease_token,
        attempt_count: job.attempt_count,
        max_attempts: job.max_attempts,
        user_summary: plan.summary,
        plan,
      },
    });
  } catch (error) {
    if (job) {
      await failPlanning({
        jobId: job.id,
        leaseToken: job.lease_token,
        attemptCount: job.attempt_count,
        maxAttempts: job.max_attempts,
        error,
      }).catch(() => undefined);
    }
    return json(
      {
        ok: false,
        message: redactReliabilityText(
          error instanceof Error ? error.message : String(error ?? "자동개선 계획 실패"),
          1_000,
        ),
      },
      500,
    );
  }
}
