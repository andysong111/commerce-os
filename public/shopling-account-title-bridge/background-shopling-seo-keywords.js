"use strict";

const SEO_KEYWORD_POOL_MESSAGE = "commerce-os-shopling-seo-keyword-pool";
const SEO_KEYWORD_POOL_ENDPOINT =
  "https://commerce-os-ops-center.vercel.app/api/shopling-account-title-bridge/keyword-pool";
const SEO_KEYWORD_POOL_BRIDGE_VERSION = "v0.3.1";
const SEO_KEYWORD_POOL_TIMEOUT_MS = 8000;

function normalizedGoodsKey(value) {
  const goodsKey = String(value || "").trim();
  return /^\d{5,9}$/.test(goodsKey) ? goodsKey : "";
}

async function fetchSeoKeywordPool(goodsKey) {
  const url = new URL(SEO_KEYWORD_POOL_ENDPOINT);
  url.searchParams.set("goodsKey", goodsKey);
  url.searchParams.set("bridge", SEO_KEYWORD_POOL_BRIDGE_VERSION);

  const response = await fetch(url.href, {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(SEO_KEYWORD_POOL_TIMEOUT_MS),
  });
  if (!response.ok) {
    return { ok: false, keywords: [], error: `SEO keyword pool HTTP ${response.status}` };
  }

  const body = await response.json().catch(() => null);
  const keywords = Array.isArray(body?.keywords)
    ? body.keywords
        .map((value) => String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 64)
    : [];
  return {
    ok: body?.ok === true,
    keywords,
    candidateCount: Number(body?.candidateCount || keywords.length),
    source: String(body?.source || "none"),
    error: body?.ok === true ? "" : String(body?.error || "SEO keyword pool unavailable"),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== SEO_KEYWORD_POOL_MESSAGE) return false;
  const goodsKey = normalizedGoodsKey(message.goodsKey);
  if (!goodsKey) {
    sendResponse({ ok: false, keywords: [], error: "invalid_goods_key" });
    return false;
  }

  fetchSeoKeywordPool(goodsKey)
    .then(sendResponse)
    .catch((error) =>
      sendResponse({
        ok: false,
        keywords: [],
        error: error instanceof Error ? error.message : String(error || "SEO keyword pool failed"),
      }),
    );
  return true;
});
