const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const SEED_PATH_SUFFIX = "/product-launch-tracker-app/data/launch-items.json";

export function filterDeletedSeedItems(seed, deletedItemIds) {
  if (!seed || typeof seed !== "object" || !Array.isArray(seed.items)) {
    return seed;
  }

  const deletedIds = new Set(
    [...(deletedItemIds ?? [])]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  );
  if (!deletedIds.size) return seed;

  const items = seed.items.filter((item) => {
    const id = String(item?.id ?? "").trim();
    return !id || !deletedIds.has(id);
  });
  if (items.length === seed.items.length) return seed;

  return {
    ...seed,
    meta: {
      ...(seed.meta && typeof seed.meta === "object" ? seed.meta : {}),
      launchItemCount: items.length,
    },
    items,
  };
}

if (typeof window !== "undefined") {
  installDeletedSeedFilter();
}

function installDeletedSeedFilter() {
  if (window.__commerceOsTrackerDeletedSeedFilterInstalled) return;
  window.__commerceOsTrackerDeletedSeedFilterInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function deletedSeedAwareFetch(input, init) {
    const response = await nativeFetch(input, init);
    if (!response.ok || !isLaunchSeedRequest(input)) return response;

    try {
      const stored = readStoredState();
      const filtered = filterDeletedSeedItems(
        await response.clone().json(),
        stored?.serverDeletedItemIds,
      );
      if (!filtered || !Array.isArray(filtered.items)) return response;

      const headers = new Headers(response.headers);
      headers.set("content-type", "application/json; charset=utf-8");
      headers.delete("content-length");
      return new Response(JSON.stringify(filtered), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      console.warn("Deleted tracker rows could not be filtered from seed data.", error);
      return response;
    }
  };
}

function isLaunchSeedRequest(input) {
  try {
    const rawUrl = input instanceof Request ? input.url : String(input ?? "");
    const url = new URL(rawUrl, window.location.href);
    return url.pathname.endsWith(SEED_PATH_SUFFIX);
  } catch {
    return false;
  }
}

function readStoredState() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}
