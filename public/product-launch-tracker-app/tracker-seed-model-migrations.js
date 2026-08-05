const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const SEED_PATH_SUFFIX = "/product-launch-tracker-app/data/launch-items.json";
const TARGET_MODEL = "AAA451";
const NEXT_MODEL = "AAA452";
const TARGET_PRODUCT_NAME = "반자동 책갈피 3P 색상랜덤";

export function migrateTrackerModelNumbers(
  value,
  now = new Date().toISOString(),
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { changed: false, value };
  }
  if (!Array.isArray(value.items)) return { changed: false, value };

  const targetEntries = value.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isTarget(item));
  if (!targetEntries.length) return { changed: false, value };

  const canonicalEntries = value.items
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) =>
        normalizeModel(item?.modelNumber) === NEXT_MODEL &&
        normalizeProductName(item?.productName) ===
          normalizeProductName(TARGET_PRODUCT_NAME),
    );

  if (canonicalEntries.length === 1) {
    const canonical = canonicalEntries[0];
    const duplicateTargets = targetEntries.filter(({ item }) =>
      sameBarcodeIdentity(item, canonical.item),
    );
    if (duplicateTargets.length === targetEntries.length) {
      const duplicateIds = new Set(
        duplicateTargets
          .map(({ item }) => String(item?.id ?? "").trim())
          .filter(Boolean),
      );
      const primaryDuplicate = duplicateTargets[0]?.item ?? {};
      const items = value.items.flatMap((item, index) => {
        if (duplicateTargets.some((entry) => entry.index === index)) return [];
        if (index !== canonical.index) return [item];
        return [mergeDuplicateItem(canonical.item, primaryDuplicate, now)];
      });
      return {
        changed: true,
        value: {
          ...value,
          items,
          serverDeletedItemIds: [
            ...new Set([
              ...stringArray(value.serverDeletedItemIds),
              ...duplicateIds,
            ]),
          ],
        },
      };
    }
  }

  const targetIndexes = new Set(targetEntries.map(({ index }) => index));
  return {
    changed: true,
    value: {
      ...value,
      items: value.items.map((item, index) =>
        targetIndexes.has(index)
          ? {
              ...item,
              modelNumber: NEXT_MODEL,
              productName: TARGET_PRODUCT_NAME,
              updatedAt: now,
              updatedBy: "승준",
            }
          : item,
      ),
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated.value));
  } catch (error) {
    console.warn("Stored tracker model migration could not be applied.", error);
  }
}

function mergeDuplicateItem(canonical, duplicate, now) {
  return {
    ...duplicate,
    ...canonical,
    modelNumber: NEXT_MODEL,
    productName: TARGET_PRODUCT_NAME,
    barcode: String(canonical?.barcode ?? "").trim() || String(duplicate?.barcode ?? "").trim(),
    orderOptions:
      Array.isArray(canonical?.orderOptions) && canonical.orderOptions.length
        ? canonical.orderOptions
        : duplicate?.orderOptions,
    stages: mergeStages(canonical?.stages, duplicate?.stages),
    source: mergeSource(canonical?.source, duplicate?.source),
    updatedAt: now,
    updatedBy: "승준",
  };
}

function mergeStages(canonicalStages, duplicateStages) {
  const canonical = asRecord(canonicalStages);
  const duplicate = asRecord(duplicateStages);
  const keys = new Set([...Object.keys(duplicate), ...Object.keys(canonical)]);
  return Object.fromEntries(
    [...keys].map((key) => {
      const left = asRecord(canonical[key]);
      const right = asRecord(duplicate[key]);
      return [
        key,
        stageRank(left.status) >= stageRank(right.status)
          ? { ...right, ...left }
          : { ...left, ...right },
      ];
    }),
  );
}

function mergeSource(canonicalSource, duplicateSource) {
  const canonical = asRecord(canonicalSource);
  const duplicate = asRecord(duplicateSource);
  return {
    ...duplicate,
    ...canonical,
    rows: uniqueValues(duplicate.rows, canonical.rows),
    sheetRowRefs: uniqueValues(
      duplicate.sheetRowRefs,
      canonical.sheetRowRefs,
    ),
  };
}

function sameBarcodeIdentity(left, right) {
  const leftBarcode = String(left?.barcode ?? "").trim().toUpperCase();
  const rightBarcode = String(right?.barcode ?? "").trim().toUpperCase();
  return Boolean(leftBarcode && rightBarcode && leftBarcode === rightBarcode);
}

function isTarget(item) {
  return (
    normalizeModel(item?.modelNumber) === TARGET_MODEL &&
    normalizeProductName(item?.productName) ===
      normalizeProductName(TARGET_PRODUCT_NAME)
  );
}

function normalizeModel(value) {
  const compact = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/^AAA0*(\d+)$/);
  return match ? `AAA${match[1].padStart(3, "0")}` : compact;
}

function normalizeProductName(value) {
  return String(value ?? "").trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
}

function stageRank(value) {
  return {
    미시작: 0,
    "진행 중": 1,
    보류: 2,
    완료: 3,
    제외: 3,
  }[String(value ?? "").trim()] ?? -1;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function uniqueValues(...values) {
  return [...new Set(values.flatMap((value) => Array.isArray(value) ? value : []))];
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => String(entry ?? "").trim()).filter(Boolean))];
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
