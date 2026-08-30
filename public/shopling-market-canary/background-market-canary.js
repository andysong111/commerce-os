"use strict";

const CANARY_API = "https://commerce-os-ops-center.vercel.app/api/shopling-account-title-bridge/pipeline";
const CANARY_BRIDGE = "v0.5.0";
const CANARY_CLAIM_MESSAGE = "commerce-os-shopling-market-canary-claim";
const CANARY_ARM_MESSAGE = "commerce-os-shopling-market-canary-arm";
const CANARY_REPORT_MESSAGE = "commerce-os-shopling-market-canary-report";

function canaryText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function validRunId(runId) {
  return /^canary-[A-Za-z0-9._:-]{8,150}$/.test(canaryText(runId));
}

function validGoodsKey(goodsKey) {
  return /^\d{5,9}$/.test(canaryText(goodsKey));
}

async function canaryPost(body) {
  try {
    const response = await fetch(CANARY_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bridge: CANARY_BRIDGE, ...body }),
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
      message: error instanceof Error ? error.message : String(error || "canary request failed"),
    };
  }
}

async function claimCanary(runId) {
  return canaryPost({ action: "canary-claim", runId });
}

async function armCanary(runId, goodsKey) {
  return canaryPost({ action: "arm-submit", runId, goodsKey });
}

async function reportCanary(runId, goodsKey, outcome, reasonCode, message) {
  return canaryPost({
    action: "report",
    runId,
    goodsKey,
    outcome,
    reasonCode: canaryText(reasonCode).slice(0, 120),
    message: canaryText(message).slice(0, 1000),
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const runId = canaryText(message.runId);
  const goodsKey = canaryText(message.goodsKey);

  if (message.type === CANARY_CLAIM_MESSAGE) {
    if (!validRunId(runId)) {
      sendResponse({ ok: false, error: "invalid_canary_run_id" });
      return false;
    }
    claimCanary(runId).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: "canary_claim_exception",
      message: error instanceof Error ? error.message : String(error || "canary claim failed"),
    }));
    return true;
  }

  if (message.type === CANARY_ARM_MESSAGE) {
    if (!validRunId(runId) || !validGoodsKey(goodsKey)) {
      sendResponse({ ok: false, error: "invalid_canary_arm" });
      return false;
    }
    armCanary(runId, goodsKey).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: "canary_arm_exception",
      message: error instanceof Error ? error.message : String(error || "canary arm failed"),
    }));
    return true;
  }

  if (message.type === CANARY_REPORT_MESSAGE) {
    const outcome = canaryText(message.outcome);
    if (!validRunId(runId) || !validGoodsKey(goodsKey) || !["sent", "already_registered", "confirm_needed", "failed"].includes(outcome)) {
      sendResponse({ ok: false, error: "invalid_canary_report" });
      return false;
    }
    reportCanary(runId, goodsKey, outcome, message.reasonCode, message.message)
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        error: "canary_report_exception",
        message: error instanceof Error ? error.message : String(error || "canary report failed"),
      }));
    return true;
  }

  return false;
});
