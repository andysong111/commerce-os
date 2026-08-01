import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  createDetailPageJobToken,
  getDetailPageJobConfig,
  listRecoverableDetailPageJobs,
} from "@/lib/detailPageJobServer";

export const runtime = "nodejs";
export const maxDuration = 50;

const RECOVERY_AFTER_MS = 8 * 60 * 1000;
const MAX_RECOVERY_JOBS = 10;
const DEFAULT_DETAIL_PAGE_STUDIO_URL =
  "https://commerce-os-detail-page-studio.vercel.app/";

function authorized(request: Request, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ error: "상세페이지 자동복구는 Production에서만 실행됩니다." }, { status: 403 });
  }
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET 설정이 없어 자동복구를 차단했습니다." }, { status: 503 });
  }
  if (!authorized(request, secret)) {
    return NextResponse.json({ error: "자동복구 인증에 실패했습니다." }, { status: 401 });
  }
  const config = getDetailPageJobConfig();
  if (!config.ok) return NextResponse.json(config.body, { status: config.status });
  const studio = new URL(
    process.env.DETAIL_PAGE_STUDIO_INTERNAL_URL?.trim() ||
      process.env.NEXT_PUBLIC_DETAIL_PAGE_STUDIO_INTERNAL_URL?.trim() ||
      DEFAULT_DETAIL_PAGE_STUDIO_URL,
  );
  const workerUrl = new URL("/api/internal/ops-detail-page-job", studio).toString();
  const jobs = await listRecoverableDetailPageJobs(config.value, 50);
  const now = Date.now();
  const stale = jobs
    .filter((job) => now - Date.parse(job.updated_at || job.created_at) >= RECOVERY_AFTER_MS)
    .slice(0, MAX_RECOVERY_JOBS);
  const results = [];
  for (const job of stale) {
    const callbackUrl = new URL(
      `/api/product-launch-tracker/detail-page-jobs/${job.id}`,
      request.url,
    ).toString();
    try {
      const response = await fetch(workerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callbackUrl,
          workerUrl,
          token: createDetailPageJobToken(config.value, job.owner_id, job.id),
        }),
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      results.push({
        job_id: job.id,
        accepted: response.ok && body?.ok === true,
        status: response.status,
      });
    } catch (error) {
      results.push({
        job_id: job.id,
        accepted: false,
        error: error instanceof Error ? error.message : "worker start failed",
      });
    }
  }
  return NextResponse.json({
    ok: true,
    checked: jobs.length,
    recovered: results.filter((item) => item.accepted).length,
    results,
  });
}
