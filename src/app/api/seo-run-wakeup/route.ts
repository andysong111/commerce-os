import { NextResponse } from "next/server";
import { getProductLaunchAdminConfig } from "@/lib/productLaunchTrackerServer";
import {
  claimSeoRunWorkerPulse,
  finishSeoRunWorkerPulse,
} from "@/lib/seoRunWorkerControl";
import { processSeoRunQueue } from "@/lib/seoRunWorker";
import { processProductLaunchShoplingPostprocessQueue } from "@/lib/productLaunchShoplingPostprocessWorker";
import { reconcileVerifiedShoplingRegistrations } from "@/lib/productLaunchShoplingRegistrationTruth";
import { rearmFailedDurableSeoRegistrationRuns } from "@/lib/productLaunchShoplingRetryRearm";
import { processSeoRunShoplingRegistrationQueue } from "@/lib/seoRunShoplingRegistrationQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const configResult = getProductLaunchAdminConfig();
  if (!configResult.ok) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  const config = configResult.value;
  const workerId = `supabase-pulse:${process.env.VERCEL_REGION || "unknown"}:${crypto.randomUUID()}`;

  try {
    const pulse = await claimSeoRunWorkerPulse(config, workerId, 300);
    if (pulse.claimed !== true) {
      return NextResponse.json({ ok: true, throttled: true });
    }
  } catch (error) {
    console.error("[seo-run-wakeup] pulse claim failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  let storedResult: Record<string, unknown> = {};
  try {
    let registrationQueueResult: Record<string, unknown> = {};
    try {
      registrationQueueResult = await processSeoRunShoplingRegistrationQueue({
        maxStarts: 5,
        maxMonitors: 100,
      });
    } catch (error) {
      console.error("[seo-run-wakeup] Shopling registration queue failed", error);
      registrationQueueResult = {
        error:
          error instanceof Error
            ? error.message
            : "Shopling registration queue failed",
      };
    }

    let registrationTruthResult: Record<string, unknown> = {};
    try {
      registrationTruthResult = await reconcileVerifiedShoplingRegistrations({
        maxRuns: 40,
      });
    } catch (error) {
      console.error("[seo-run-wakeup] Shopling registration truth recovery failed", error);
      registrationTruthResult = {
        error:
          error instanceof Error
            ? error.message
            : "Shopling registration truth recovery failed",
      };
    }

    let registrationRearmResult: Record<string, unknown> = {};
    try {
      registrationRearmResult = await rearmFailedDurableSeoRegistrationRuns({
        maxRuns: 20,
      });
    } catch (error) {
      console.error("[seo-run-wakeup] Shopling registration retry rearm failed", error);
      registrationRearmResult = {
        error:
          error instanceof Error
            ? error.message
            : "Shopling registration retry rearm failed",
      };
    }

    let postprocessResult: Record<string, unknown> = {};
    try {
      postprocessResult = await processProductLaunchShoplingPostprocessQueue({
        maxItems: 8,
      });
    } catch (error) {
      console.error("[seo-run-wakeup] Shopling postprocess recovery failed", error);
      postprocessResult = {
        error:
          error instanceof Error
            ? error.message
            : "Shopling postprocess recovery failed",
      };
    }

    const result = await processSeoRunQueue({
      workerId,
      maxJobs: 2,
      timeBudgetMs: 190_000,
    });
    storedResult = {
      ok: true,
      ...result,
      shoplingRegistrationQueue: registrationQueueResult,
      shoplingRegistrationTruth: registrationTruthResult,
      shoplingRegistrationRearm: registrationRearmResult,
      shoplingPostprocess: postprocessResult,
    };
    return NextResponse.json({
      ok: true,
      claimedCount: result.claimedCount,
      completedCount: result.completedCount,
      failedCount: result.failedCount,
      queuedCount: result.queuedCount,
      shoplingRegistrationQueue: registrationQueueResult,
      shoplingRegistrationTruth: registrationTruthResult,
      shoplingRegistrationRearm: registrationRearmResult,
      shoplingPostprocess: postprocessResult,
    });
  } catch (error) {
    console.error("[seo-run-wakeup] durable worker failed", error);
    storedResult = {
      ok: false,
      error: error instanceof Error ? error.message : "SEO RUN worker failed",
    };
    return NextResponse.json({ ok: false }, { status: 500 });
  } finally {
    await finishSeoRunWorkerPulse(config, workerId, storedResult).catch((error) => {
      console.error("[seo-run-wakeup] pulse release failed", error);
    });
  }
}
