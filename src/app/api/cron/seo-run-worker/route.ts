import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runCoalescedSeoRunShoplingWorkerPulse } from "@/lib/seoRunShoplingWorkerPulse";
import { runCoalescedSeoRunWorkerPulse } from "@/lib/seoRunWorkerPulse";

export const runtime = "nodejs";
export const maxDuration = 300;

const SAFE_INVOCATION_BUDGET_MS = 275_000;
const MIN_SEO_BUDGET_MS = 30_000;

type UnknownRecord = Record<string, unknown>;

function authorized(request: Request, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "");
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

  const invocationStartedAt = Date.now();
  let shoplingWorker: UnknownRecord = {};
  try {
    shoplingWorker = await runCoalescedSeoRunShoplingWorkerPulse({
      workerId: `cron-shopling:${process.env.VERCEL_REGION || "unknown"}:${crypto.randomUUID()}`,
      leaseSeconds: 150,
    });
  } catch (error) {
    const message = errorText(error);
    shoplingWorker = { ok: false, busy: true, error: message };
    console.error("[seo-run-cron] Shopling worker failed", error);
  }

  try {
    const elapsedMs = Date.now() - invocationStartedAt;
    const remainingMs = Math.max(0, SAFE_INVOCATION_BUDGET_MS - elapsedMs);
    const shoplingBusy = shoplingWorker.busy === true;

    if (remainingMs < MIN_SEO_BUDGET_MS) {
      return NextResponse.json({
        ok: true,
        workerId: "seo-deferred-after-shopling",
        claimedCount: 0,
        completedCount: 0,
        failedCount: 0,
        queuedCount: 1,
        seoQueuedCount: 0,
        deferredSeo: true,
        shoplingWorker,
      });
    }

    const result = await runCoalescedSeoRunWorkerPulse({
      workerId: `cron:${process.env.VERCEL_REGION || "unknown"}:${crypto.randomUUID()}`,
      maxJobs: 2,
      timeBudgetMs: Math.min(240_000, remainingMs),
      leaseSeconds: 300,
    });
    return NextResponse.json({
      ok: true,
      ...result,
      seoQueuedCount: result.queuedCount,
      queuedCount: Math.max(result.queuedCount, shoplingBusy ? 1 : 0),
      shoplingWorker,
    });
  } catch (error) {
    console.error("[seo-run-cron] worker failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "SEO RUN worker failed",
        shoplingWorker,
      },
      { status: 500 },
    );
  }
}
