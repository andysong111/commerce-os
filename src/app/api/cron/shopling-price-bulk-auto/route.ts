import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { BulkAdmin } from "@/lib/shoplingPriceModifyBulkApi";
import {
  claimNextShoplingPriceBulkAutoJob,
  releaseShoplingPriceBulkAutoJob,
  runClaimedShoplingPriceBulkAutoJob,
} from "@/lib/shoplingPriceModifyBulkAutoOrchestrator";

export const runtime = "nodejs";
export const maxDuration = 50;

const MAX_JOBS = 5;
const MAX_TRANSITIONS = 4;
const LEASE_SECONDS = 75;

function authorized(request: Request, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET 설정이 없어 자동 실행을 차단했습니다." }, { status: 503 });
  }
  if (!authorized(request, secret)) {
    return NextResponse.json({ error: "자동 실행 인증에 실패했습니다." }, { status: 401 });
  }

  const rawAdmin = await createSupabaseAdminClient();
  if (!rawAdmin) {
    return NextResponse.json({ error: "Supabase 관리자 설정이 필요합니다." }, { status: 503 });
  }
  const admin = rawAdmin as BulkAdmin;
  const invocationId = randomUUID();
  const seen = new Set<string>();
  const results: Array<Record<string, unknown>> = [];

  for (let index = 0; index < MAX_JOBS; index += 1) {
    const workerId = `cron-${invocationId}-${index}`;
    let claim;
    try {
      claim = await claimNextShoplingPriceBulkAutoJob(admin, workerId, LEASE_SECONDS);
    } catch (error) {
      results.push({ outcome: "claim_error", message: error instanceof Error ? error.message : "자동 작업을 가져오지 못했습니다." });
      break;
    }
    if (!claim.claimed || !claim.job_id || !claim.owner_id) break;

    if (seen.has(claim.job_id)) {
      try {
        await releaseShoplingPriceBulkAutoJob(admin, claim.job_id, workerId);
      } catch {
        // The lease is bounded and will expire even if release fails.
      }
      results.push({ job_id: claim.job_id, outcome: "duplicate_claim_blocked" });
      break;
    }
    seen.add(claim.job_id);

    const run = await runClaimedShoplingPriceBulkAutoJob(admin, {
      jobId: claim.job_id,
      ownerId: claim.owner_id,
      workerId,
      maxTransitions: MAX_TRANSITIONS,
    });

    let releaseError: string | null = null;
    if (!run.leaseReleased) {
      try {
        await releaseShoplingPriceBulkAutoJob(admin, claim.job_id, workerId);
      } catch (error) {
        releaseError = error instanceof Error ? error.message : "lease release failed";
      }
    }

    results.push({
      job_id: claim.job_id,
      outcome: run.outcome,
      status: run.status ?? claim.status,
      transitions: run.transitions,
      message: run.message,
      release_error: releaseError,
    });
  }

  return NextResponse.json({
    ok: true,
    invocation_id: invocationId,
    processed_job_count: results.length,
    max_jobs: MAX_JOBS,
    max_transitions_per_job: MAX_TRANSITIONS,
    results,
  });
}
