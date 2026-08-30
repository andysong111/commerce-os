"use strict";

const TITLE_LEDGER_CLAIM_MESSAGE = "commerce-os-shopling-title-ledger-claim";
const TITLE_LEDGER_REPORT_MESSAGE = "commerce-os-shopling-title-ledger-report";
const TITLE_LEDGER_RETRY_MESSAGE = "commerce-os-shopling-title-ledger-retry";
const TITLE_LEDGER_STATS_MESSAGE = "commerce-os-shopling-title-ledger-stats";
const TITLE_REGISTRY_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-account-title-bridge/title-registry";
const TITLE_REGISTRY_BRIDGE = "v0.5.3";

async function callTitleLedger(action, payload = {}) {
  try {
    const response = await fetch(TITLE_REGISTRY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bridge: TITLE_REGISTRY_BRIDGE, action, ...payload }),
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true) {
      return {
        ok: false,
        error: String(body?.error || `title_ledger_http_${response.status}`),
        message: String(body?.message || body?.error || `title_ledger_http_${response.status}`),
      };
    }
    return body;
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error || "title ledger request failed"),
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === TITLE_LEDGER_CLAIM_MESSAGE) {
    callTitleLedger("claim", { runId: message.runId, limit: message.limit || 500 })
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: String(error || "title claim failed") }));
    return true;
  }

  if (message.type === TITLE_LEDGER_REPORT_MESSAGE) {
    callTitleLedger("report", {
      runId: message.runId,
      goodsKey: message.goodsKey,
      outcome: message.outcome,
      reasonCode: message.reasonCode || "",
      message: message.message || "",
    })
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: String(error || "title report failed") }));
    return true;
  }

  if (message.type === TITLE_LEDGER_RETRY_MESSAGE) {
    callTitleLedger("retry-failures", { limit: message.limit || 500 })
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: String(error || "title retry failed") }));
    return true;
  }

  if (message.type === TITLE_LEDGER_STATS_MESSAGE) {
    callTitleLedger("stats")
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: String(error || "title stats failed") }));
    return true;
  }

  return false;
});
