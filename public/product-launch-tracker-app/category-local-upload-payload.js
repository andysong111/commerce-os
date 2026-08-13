const CATEGORY_RESULT_ENDPOINT = "/api/shopling-categories/local-result";
const originalFetch = window.fetch.bind(window);

window.fetch = function commerceOsCategoryCompactFetch(input, init) {
  const url = requestUrl(input);
  if (!url.includes(CATEGORY_RESULT_ENDPOINT) || !init || typeof init.body !== "string") {
    return originalFetch(input, init);
  }

  try {
    const parsed = JSON.parse(init.body);
    const snapshot = parsed?.snapshot;
    const compact = compactSnapshot(snapshot);
    if (!compact) return originalFetch(input, init);
    return originalFetch(input, {
      ...init,
      body: JSON.stringify({ snapshot: compact }),
    });
  } catch {
    return originalFetch(input, init);
  }
};

function compactSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.categories)) {
    return null;
  }
  const categories = [];
  for (const row of snapshot.categories) {
    if (!row || typeof row !== "object") continue;
    const path = text(row.path);
    const codes = Array.isArray(row.codes)
      ? row.codes.map(text).filter(Boolean).slice(0, 4)
      : [];
    if (!path || !codes.length) continue;
    categories.push({ path, codes });
  }
  if (!categories.length) return null;
  return {
    requestId: text(snapshot.requestId),
    collectedAt: text(snapshot.collectedAt),
    categoryPageUrl: text(snapshot.categoryPageUrl),
    categories,
  };
}

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return String(input ?? "");
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
