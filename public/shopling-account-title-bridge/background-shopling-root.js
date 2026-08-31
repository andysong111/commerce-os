"use strict";

importScripts(
  "background-shopling-title-batch.js",
  "background-shopling-title-registry.js",
  "background-shopling-seo-keywords.js",
  "background-shopling-pipeline.js",
  "background-shopling-lifecycle.js",
  "background-shopling-lifecycle-main-exec.js",
);

// The lifecycle worker historically reused its recurring alarm name for a
// one-shot five-second wake-up after each completed task. Chrome replaces an
// existing alarm with the same name, so the recurring poller disappeared after
// the first successful lifecycle run. Keep an independent recurring alarm that
// no one-shot wake-up path can overwrite.
const SHOPLING_LIFECYCLE_RECURRING_KEEPER_ALARM = "commerce-os-shopling-lifecycle-recurring-keeper";

async function ensureShoplingLifecycleRecurringKeeper() {
  try {
    const existing = await chrome.alarms.get(SHOPLING_LIFECYCLE_RECURRING_KEEPER_ALARM);
    if (existing?.periodInMinutes === 1) return;
    await chrome.alarms.create(SHOPLING_LIFECYCLE_RECURRING_KEEPER_ALARM, {
      delayInMinutes: 0.5,
      periodInMinutes: 1,
    });
  } catch {
    // The original lifecycle alarm remains a fallback; never break the rest of
    // the Shopling extension merely because alarm persistence is unavailable.
  }
}

void ensureShoplingLifecycleRecurringKeeper();
chrome.runtime.onInstalled.addListener(() => void ensureShoplingLifecycleRecurringKeeper());
chrome.runtime.onStartup.addListener(() => void ensureShoplingLifecycleRecurringKeeper());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== SHOPLING_LIFECYCLE_RECURRING_KEEPER_ALARM) return;
  if (typeof lifecycleProcessExecutorQueue !== "function") return;
  void lifecycleProcessExecutorQueue();
});
