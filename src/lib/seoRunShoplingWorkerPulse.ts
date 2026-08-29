import type { ProductLaunchAdminConfig } from "@/lib/productLaunchTrackerServer";
import { getProductLaunchAdminConfig } from "@/lib/productLaunchTrackerServer";
import { runSeoRunShoplingPulseWork } from "@/lib/seoRunShoplingPulseWork";
import {
  claimSeoRunShoplingWorkerPulse,
  finishSeoRunShoplingWorkerPulse,
} from "@/lib/seoRunShoplingWorkerControl";

type UnknownRecord = Record<string, unknown>;
type ShoplingPulseWork = Awaited<
  ReturnType<typeof runSeoRunShoplingPulseWork>
>;

export type SeoRunShoplingWorkerPulseResult = ShoplingPulseWork & {
  pulseClaimed: boolean;
  throttled: boolean;
  busy: boolean;
};

type PulseOptions = {
  config?: ProductLaunchAdminConfig;
  workerId: string;
  leaseSeconds?: number;
};

let localPulsePromise: Promise<SeoRunShoplingWorkerPulseResult> | null = null;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function integer(value: unknown) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function workIsBusy(work: ShoplingPulseWork) {
  const queue = record(work.registrationQueue);
  return (
    integer(queue.queuedOrActiveCount) > 0 ||
    integer(queue.startedCount) > 0 ||
    integer(queue.attachedCount) > 0 ||
    integer(queue.runningCount) > 0 ||
    integer(queue.monitoredCount) > 0 ||
    integer(record(work.registrationTruth).candidateCount) > 0 ||
    integer(record(work.postprocess).processedCount) > 0
  );
}

export function runCoalescedSeoRunShoplingWorkerPulse(options: PulseOptions) {
  if (localPulsePromise) return localPulsePromise;
  localPulsePromise = runSeoRunShoplingWorkerPulse(options).finally(() => {
    localPulsePromise = null;
  });
  return localPulsePromise;
}

export async function runSeoRunShoplingWorkerPulse(
  options: PulseOptions,
): Promise<SeoRunShoplingWorkerPulseResult> {
  const config = options.config ?? requiredConfig();
  const leaseSeconds = Math.max(
    30,
    Math.min(300, Math.trunc(options.leaseSeconds ?? 120)),
  );
  const pulse = await claimSeoRunShoplingWorkerPulse(
    config,
    options.workerId,
    leaseSeconds,
  );
  if (pulse.claimed !== true) {
    return {
      pulseClaimed: false,
      throttled: true,
      busy: true,
      registrationQueue: {},
      registrationTruth: {},
      registrationRearm: {},
      postprocess: {},
    };
  }

  let storedResult: UnknownRecord = {};
  try {
    const work = await runSeoRunShoplingPulseWork();
    const busy = workIsBusy(work);
    storedResult = { ok: true, busy, ...work };
    return {
      ...work,
      pulseClaimed: true,
      throttled: false,
      busy,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    storedResult = { ok: false, error: message.slice(0, 1000) };
    throw error;
  } finally {
    await finishSeoRunShoplingWorkerPulse(
      config,
      options.workerId,
      storedResult,
    ).catch((error) => {
      console.error(
        "[seo-run-shopling-pulse] global lease release failed",
        error,
      );
    });
  }
}

function requiredConfig() {
  const result = getProductLaunchAdminConfig();
  if (!result.ok) throw new Error(result.body.message);
  return result.value;
}
