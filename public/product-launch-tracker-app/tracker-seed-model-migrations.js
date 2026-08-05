const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const SEED_PATH_SUFFIX = "/product-launch-tracker-app/data/launch-items.json";
const TARGET_MODEL = "AAA451";
const NEXT_MODEL = "AAA452";
const TARGET_PRODUCT_NAME = "반자동 책갈피 3P 색상랜덤";

export function migrateTrackerModelNumbers(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { changed: false, value };
  }
  if (!Array.isArray(value.items)) return { changed: false, value };

  let changed = false;
  const items = value.items.map((item) => {
    if (!isTarget(item)) return item;
    changed = true;
    return {
      ...item,
      modelNumber: NEXT_MODEL,
      updatedAt: item.updatedAt ?? new Date().toISOString(),
      updatedBy: item.updatedBy ?? "승준",
    };
  });
  if (!changed) return { changed: false, value };

  return {
    changed: true,
    value: {
      ...value,
      items,
    },
  };
}

if (typeof window !== "undefined") {
  installTrackerSeedModelMigrations();
}

function installTrackerSeedModelMigrations() {
  if (window.__commerceOsTrackerSeedModelMigrationsInstalled) return;
  window.__commerceOsTrackerSeedModelMigrationsInstalled = true;
  migrateStoredState();

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function modelMigrationAwareFetch(input, init) {
    const response = await nativeFetch(input, init);
    if (!response.ok || !isLaunchSeedRequest(input)) return response;

    try {
      const migrated = migrateTrackerModelNumbers(await response.clone().json());
      if (!migrated.changed) return response;
      const headers = new Headers(response.headers);
      headers.set("content-type", "application/json; charset=utf-8");
      headers.delete("content-length");
      return new Response(JSON.stringify(migrated.value), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      console.warn("Tracker model migration could not be applied.", error);
      return response;
    }
  };
}

function migrateStoredState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const migrated = migrateTrackerModelNumbers(parsed);
    if (!migrated.changed) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...migrated.value,
        savedAt: new Date().toISOString(),
      }),
    );
  } catch (error) {
    console.warn("Stored tracker model migration could not be applied.", error);
  }
}

function isTarget(item) {
  return (
    normalizeModel(item?.modelNumber) === TARGET_MODEL &&
    String(item?.productName ?? "").trim() === TARGET_PRODUCT_NAME
  );
}

function normalizeModel(value) {
  const compact = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/^AAA0*(\d+)$/);
  return match ? `AAA${match[1].padStart(3, "0")}` : compact;
}

function isLaunchSeedRequest(input) {
  try {
    const rawUrl = input instanceof Request ? input.url : String(input ?? "");
    return new URL(rawUrl, window.location.href).pathname.endsWith(
      SEED_PATH_SUFFIX,
    );
  } catch {
    return false;
  }
}
