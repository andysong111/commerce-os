import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runCoalescedSeoRunWorkerPulse } from "@/lib/seoRunWorkerPulse";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json(
      { error: "SEO RUN worker는 Production에서만 실행됩니다." },
      { status: 403 },
    );
  }
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET 설정이 없어 SEO RUN worker를 차단했습니다." },
      { status: 503 },
    );
  }
  if (!authorized(request, secret)) {
    return NextResponse.json(
      { error: "SEO RUN worker 인증에 실패했습니다." },
      { status: 401 },
    );
  }

  try {
    const result = await runCoalescedSeoRunWorkerPulse({
      workerId: `cron:${process.env.VERCEL_REGION || "unknown"}:${crypto.randomUUID()}`,
      maxJobs: 2,
      timeBudgetMs: 240_000,
      leaseSeconds: 300,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[seo-run-cron] worker failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "SEO RUN worker failed",
      },
      { status: 500 },
    );
  }
}
