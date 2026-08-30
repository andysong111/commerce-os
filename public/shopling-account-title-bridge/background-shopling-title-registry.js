"use strict";

const TITLE_REGISTRY_MESSAGE = "commerce-os-shopling-title-registry-keys";
const TITLE_REGISTRY_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-account-title-bridge/title-registry";
const TITLE_REGISTRY_BRIDGE = "v0.5.2";

async function loadRegisteredGoodsKeys() {
  try {
    const response = await fetch(TITLE_REGISTRY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bridge: TITLE_REGISTRY_BRIDGE }),
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) {
      return {
        ok: false,
        message: String(payload?.message || payload?.error || `title_registry_http_${response.status}`),
      };
    }
    const goodsKeys = [...new Set((Array.isArray(payload.goodsKeys) ? payload.goodsKeys : [])
      .map((value) => String(value || "").trim())
      .filter((value) => /^\d{5,9}$/.test(value)))];
    return {
      ok: true,
      goodsKeys,
      count: goodsKeys.length,
      source: String(payload.source || "shopling_product_group_registry"),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error || "title registry request failed"),
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== TITLE_REGISTRY_MESSAGE) return false;
  loadRegisteredGoodsKeys()
    .then(sendResponse)
    .catch((error) => sendResponse({
      ok: false,
      message: error instanceof Error ? error.message : String(error || "title registry failed"),
    }));
  return true;
});
