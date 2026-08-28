import { processProductLaunchShoplingPostprocessQueue } from "@/lib/productLaunchShoplingPostprocessWorker";
import { reconcileVerifiedShoplingRegistrations } from "@/lib/productLaunchShoplingRegistrationTruth";
import { rearmFailedDurableSeoRegistrationRuns } from "@/lib/productLaunchShoplingRetryRearm";
import { processSeoRunShoplingRegistrationQueue } from "@/lib/seoRunShoplingRegistrationQueue";

type UnknownRecord = Record<string, unknown>;

async function safeStep(
  label: string,
  runner: () => Promise<UnknownRecord>,
): Promise<UnknownRecord> {
  try {
    return await runner();
  } catch (error) {
    console.error(`[seo-run-shopling-pulse] ${label} failed`, error);
    return {
      error:
        error instanceof Error ? error.message : `${label} failed`,
    };
  }
}

export async function runSeoRunShoplingPulseWork() {
  const registrationQueue = await safeStep("registration queue", () =>
    processSeoRunShoplingRegistrationQueue({
      maxStarts: 5,
      maxMonitors: 100,
    }),
  );

  const registrationTruth = await safeStep("registration truth", () =>
    reconcileVerifiedShoplingRegistrations({
      maxRuns: 60,
    }),
  );

  const registrationRearm = await safeStep("registration rearm", () =>
    rearmFailedDurableSeoRegistrationRuns({
      maxRuns: 30,
    }),
  );

  const postprocess = await safeStep("postprocess", () =>
    processProductLaunchShoplingPostprocessQueue({
      maxItems: 10,
    }),
  );

  return {
    registrationQueue,
    registrationTruth,
    registrationRearm,
    postprocess,
  };
}
