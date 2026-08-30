"use strict";

const SHOPLING_CANARY_API = "https://commerce-os-ops-center.vercel.app/api/shopling-account-title-bridge/pipeline";
const SHOPLING_CANARY_BRIDGE = "v0.5.0";
const SHOPLING_CANARY_CLAIM_MESSAGE = "commerce-os-shopling-market-canary-claim";

function canaryText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

async function canaryClaim(runId) {
  try {
    const response = await fetch(SHOPLING_CANARY_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bridge: SHOPLING_CANARY_BRIDGE,
        action: "canary-claim",
        runId,
      }),
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) {
      return {
        ok: false,
        error: canaryText(payload?.error) || `canary_http_${response.status}`,
        message: canaryText(payload?.message),
      };
    }
    return payload;
  } catch (error) {
    return {
      ok: false,
      error: "canary_transport_failed",
      message: error instanceof Error ? error.message : String(error || "canary claim failed"),
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== SHOPLING_CANARY_CLAIM_MESSAGE) return false;
  const runId = canaryText(message.runId);
  if (!/^canary-[A-Za-z0-9._:-]{8,150}$/.test(runId)) {
    sendResponse({ ok: false, error: "invalid_canary_run_id" });
    return false;
  }
  canaryClaim(runId).then(sendResponse).catch((error) => sendResponse({
    ok: false,
    error: "canary_claim_exception",
    message: error instanceof Error ? error.message : String(error || "canary claim failed"),
  }));
  return true;
});
