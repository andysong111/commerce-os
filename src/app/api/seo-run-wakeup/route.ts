import { NextResponse } from "next/server";
import { getProductLaunchAdminConfig } from "@/lib/productLaunchTrackerServer";
import { runSeoRunShoplingPulseWork } from "@/lib/seoRunShoplingPulseWork";
import {
  claimSeoRunShoplingWorkerPulse,
  finishSeoRunShoplingWorkerPulse,
} from "@/lib/seoRunShoplingWorkerControl";
import {
  claimSeoRunWorkerPulse,
  finishSeoRunWorkerPulse,
} from "@/lib/seoRunWorkerControl";
import { processSeoRunQueue } from "@/lib/seoRunWorker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type UnknownRecord = Record<string, unknown>;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "");
}

function dedicatedShoplingLeaseMissing(error: unknown) {
  const message = errorText(error).toLowerCase();
  return (
    message.includes("pgrst202") ||
    message.includes("claim_seo_run_shopling_worker_pulse") &&
      (message.includes("not found") ||
        message.includes("does not exist") ||
        message.includes("could not find"))
  );
}

export async function GET() {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const configResult = getProductLaunchAdminConfig();
  if (!configResult.ok) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  const config = configResult.value;

  // Migration-safe bridge: the existing SEO cron already fires every minute.
  // Before the dedicated Supabase lease exists, the global SEO lease performs a
  // bounded Shopling fallback. As soon as the dedicated RPC exists, Shopling work
  // uses its own lease and no longer waits for long keyword generation.
  const shoplingWorkerId = `shopling-bridge:${process.env.VERCEL_REGION || "unknown"}:${crypto.randomUUID()}`;
  let dedicatedShoplingLeaseAvailable = false;
  let shoplingBridgeResult: UnknownRecord = {};
  try {
    const pulse = await claimSeoRunShoplingWorkerPulse(
      config,
      shoplingWorkerId,
      120,
    );
    dedicatedShoplingLeaseAvailable = true;
    if (pulse.claimed === true) {
      try {
        shoplingBridgeResult = {
          mode: "dedicated",
          ...(await runSeoRunShoplingPulseWork()),
        };
      } finally {
        await finishSeoRunShoplingWorkerPulse(
          config,
          shoplingWorkerId,
          shoplingBridgeResult,
        ).catch((error) => {
          console.error("[seo-run-wakeup] dedicated Shopling pulse release failed", error);
        });
      }
    } else {
      shoplingBridgeResult = { mode: "dedicated", throttled: true };
    }
  } catch (error) {
    if (dedicatedShoplingLeaseMissing(error)) {
      shoplingBridgeResult = {
        mode: "global-fallback-pending-migration",
        migrationPending: true,
      };
    } else {
      // Do not start an unlocked fallback for transient DB/RPC failures because a
      // dedicated worker may actually be active. The next minute pulse will retry.
      dedicatedShoplingLeaseAvailable = true;
      shoplingBridgeResult = {
        mode: "dedicated-unavailable-transient",
        error: errorText(error),
      };
      console.error("[seo-run-wakeup] dedicated Shopling pulse claim failed", error);
    }
  }

  const workerId = `supabase-pulse:${process.env.VERCEL_REGION || "unknown"}:${crypto.randomUUID()}`;
  try {
    const pulse = await claimSeoRunWorkerPulse(config, workerId, 300);
    if (pulse.claimed !== true) {
      return NextResponse.json({
        ok: true,
        throttled: true,
        shoplingWorker: shoplingBridgeResult,
      });
    }
  } catch (error) {
    console.error("[seo-run-wakeup] pulse claim failed", error);
    return NextResponse.json({
      ok: false,
      shoplingWorker: shoplingBridgeResult,
    }, { status: 500 });
  }

  let storedResult: UnknownRecord = {};
  try {
    if (!dedicatedShoplingLeaseAvailable) {
      shoplingBridgeResult = {
        mode: "global-fallback",
        ...(await runSeoRunShoplingPulseWork()),
      };
    }

    const result = await processSeoRunQueue({
      workerId,
      maxJobs: 2,
      timeBudgetMs: 240_000,
    });
    storedResult = {
      ok: true,
      ...result,
      shoplingWorker: shoplingBridgeResult,
    };
    return NextResponse.json({
      ok: true,
      claimedCount: result.claimedCount,
      completedCount: result.completedCount,
      failedCount: result.failedCount,
      queuedCount: result.queuedCount,
      shoplingWorker: shoplingBridgeResult,
    });
  } catch (error) {
    console.error("[seo-run-wakeup] durable worker failed", error);
    storedResult = {
      ok: false,
      error: errorText(error) || "SEO RUN worker failed",
      shoplingWorker: shoplingBridgeResult,
    };
    return NextResponse.json({ ok: false }, { status: 500 });
  } finally {
    await finishSeoRunWorkerPulse(config, workerId, storedResult).catch((error) => {
      console.error("[seo-run-wakeup] pulse release failed", error);
    });
  }
}
