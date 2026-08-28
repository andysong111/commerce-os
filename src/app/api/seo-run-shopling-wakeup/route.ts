import { NextResponse } from "next/server";
import { getProductLaunchAdminConfig } from "@/lib/productLaunchTrackerServer";
import { runSeoRunShoplingPulseWork } from "@/lib/seoRunShoplingPulseWork";
import {
  claimSeoRunShoplingWorkerPulse,
  finishSeoRunShoplingWorkerPulse,
} from "@/lib/seoRunShoplingWorkerControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const configResult = getProductLaunchAdminConfig();
  if (!configResult.ok) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  const config = configResult.value;
  const workerId = `shopling-pulse:${process.env.VERCEL_REGION || "unknown"}:${crypto.randomUUID()}`;

  try {
    const pulse = await claimSeoRunShoplingWorkerPulse(config, workerId, 120);
    if (pulse.claimed !== true) {
      return NextResponse.json({ ok: true, throttled: true });
    }
  } catch (error) {
    console.error("[seo-run-shopling-wakeup] pulse claim failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  let storedResult: Record<string, unknown> = {};
  try {
    const work = await runSeoRunShoplingPulseWork();
    storedResult = { ok: true, ...work };
    return NextResponse.json(storedResult);
  } catch (error) {
    console.error("[seo-run-shopling-wakeup] worker failed", error);
    storedResult = {
      ok: false,
      error:
        error instanceof Error ? error.message : "Shopling durable worker failed",
    };
    return NextResponse.json({ ok: false }, { status: 500 });
  } finally {
    await finishSeoRunShoplingWorkerPulse(config, workerId, storedResult).catch(
      (error) => {
        console.error("[seo-run-shopling-wakeup] pulse release failed", error);
      },
    );
  }
}
