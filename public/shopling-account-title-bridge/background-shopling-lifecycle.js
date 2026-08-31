"use strict";

const SHOPLING_LIFECYCLE_DIAGNOSTIC_MESSAGE = "commerce-os-shopling-lifecycle-dom-diagnostic-report";
const SHOPLING_LIFECYCLE_CLAIM_MESSAGE = "commerce-os-shopling-lifecycle-claim";
const SHOPLING_LIFECYCLE_REPORT_MESSAGE = "commerce-os-shopling-lifecycle-report";
const SHOPLING_LIFECYCLE_DIAGNOSTIC_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-lifecycle-diagnostic";
const SHOPLING_LIFECYCLE_BRIDGE_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-lifecycle-bridge";
const SHOPLING_LIFECYCLE_DIAGNOSTIC_BRIDGE = "lifecycle-dom-v0.5.5";
const SHOPLING_LIFECYCLE_QUEUE_BRIDGE = "lifecycle-v1";

async function postShoplingLifecycle(endpoint, payload, timeoutMs = 15000) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true) {
      return {
        ok: false,
        error: String(body?.error || `shopling_lifecycle_http_${response.status}`),
        message: String(body?.message || body?.error || `shopling_lifecycle_http_${response.status}`),
      };
    }
    return body;
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error || "shopling lifecycle request failed"),
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === SHOPLING_LIFECYCLE_DIAGNOSTIC_MESSAGE) {
    postShoplingLifecycle(
      SHOPLING_LIFECYCLE_DIAGNOSTIC_ENDPOINT,
      {
        bridge: SHOPLING_LIFECYCLE_DIAGNOSTIC_BRIDGE,
        pathname: message.pathname,
        topFrame: message.topFrame === true,
        frameDepth: message.frameDepth,
        readyState: message.readyState,
        candidates: Array.isArray(message.candidates) ? message.candidates : [],
        forms: Array.isArray(message.forms) ? message.forms : [],
        capturedAt: message.capturedAt,
      },
      15000,
    )
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: String(error || "lifecycle diagnostic failed") }));
    return true;
  }

  if (message.type === SHOPLING_LIFECYCLE_CLAIM_MESSAGE) {
    postShoplingLifecycle(
      SHOPLING_LIFECYCLE_BRIDGE_ENDPOINT,
      {
        bridge: SHOPLING_LIFECYCLE_QUEUE_BRIDGE,
        action: "claim",
        runId: message.runId,
        limit: message.limit || 5,
      },
      15000,
    )
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: String(error || "lifecycle claim failed") }));
    return true;
  }

  if (message.type === SHOPLING_LIFECYCLE_REPORT_MESSAGE) {
    postShoplingLifecycle(
      SHOPLING_LIFECYCLE_BRIDGE_ENDPOINT,
      {
        bridge: SHOPLING_LIFECYCLE_QUEUE_BRIDGE,
        action: "report",
        runId: message.runId,
        taskId: message.taskId,
        outcome: message.outcome,
        message: message.message || "",
      },
      15000,
    )
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: String(error || "lifecycle report failed") }));
    return true;
  }

  return false;
});
