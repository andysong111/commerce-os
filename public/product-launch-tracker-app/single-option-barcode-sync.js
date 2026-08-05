const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const SEED_PATH_SUFFIX = "/product-launch-tracker-app/data/launch-items.json";
const EXTERNAL_STATE_EVENT = "product-launch-tracker:external-state";

export function syncSingleOptionBarcodes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { changed: false, value };
  }
  if (!Array.isArray(value.items)) return { changed: false, value };

  let changed = false;
  const items = value.items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const orderOptions = Array.isArray(item.orderOptions) ? item.orderOptions : [];
    if (orderOptions.length !== 1) return item;
    const option = orderOptions[0] && typeof orderOptions[0] === "object"
      ? orderOptions[0]
      : { saleOption: orderOptions[0] };
    const mainBarcode = normalizeBarcode(item.barcode);
    const optionBarcode = normalizeBarcode(option.barcode);
    const barcode = mainBarcode || optionBarcode;
    if (!barcode) return item;
    if (mainBarcode === barcode && optionBarcode === barcode) return item;
    changed = true;
    return {
      ...item,
      barcode,
      orderOptions: [{ ...option, barcode }],
    };
  });

  return changed
    ? { changed: true, value: { ...value, items } }
    : { changed: false, value };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  installSingleOptionBarcodeSync();
}

function installSingleOptionBarcodeSync() {
  if (window.__commerceOsSingleOptionBarcodeSyncInstalled) return;
  window.__commerceOsSingleOptionBarcodeSyncInstalled = true;
  migrateStoredState();
  interceptSeedFetch();

  document.addEventListener(
    "change",
    (event) => {
      if (!(event.target instanceof HTMLInputElement)) return;
      if (!event.target.matches(".barcode-input")) return;
      const itemId = String(event.target.closest("tr[data-id]")?.dataset.id ?? "").trim();
      const barcode = normalizeBarcode(event.target.value);
      if (!itemId) return;
      window.setTimeout(() => syncStoredItem(itemId, barcode), 0);
    },
    true,
  );
}

function migrateStoredState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const result = syncSingleOptionBarcodes(parsed);
    if (!result.changed) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...result.value, savedAt: new Date().toISOString() }),
    );
  } catch (error) {
    console.warn("Single option barcode migration could not be applied.", error);
  }
}

function interceptSeedFetch() {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function singleOptionBarcodeAwareFetch(input, init) {
    const response = await nativeFetch(input, init);
    if (!response.ok || !isLaunchSeedRequest(input)) return response;
    try {
      const result = syncSingleOptionBarcodes(await response.clone().json());
      if (!result.changed) return response;
      const headers = new Headers(response.headers);
      headers.set("content-type", "application/json; charset=utf-8");
      headers.delete("content-length");
      return new Response(JSON.stringify(result.value), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      console.warn("Single option barcode seed sync could not be applied.", error);
      return response;
    }
  };
}

function syncStoredItem(itemId, inputBarcode) {
  try {
    const state = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!state || !Array.isArray(state.items)) return;
    const index = state.items.findIndex(
      (item) => String(item?.id ?? "").trim() === itemId,
    );
    if (index < 0) return;
    const item = state.items[index];
    const options = Array.isArray(item?.orderOptions) ? item.orderOptions : [];
    if (options.length !== 1) return;
    const option = options[0] && typeof options[0] === "object"
      ? options[0]
      : { saleOption: options[0] };
    const barcode = inputBarcode || normalizeBarcode(option.barcode);
    if (!barcode) return;
    const currentMain = normalizeBarcode(item.barcode);
    const currentOption = normalizeBarcode(option.barcode);
    if (currentMain === barcode && currentOption === barcode) return;

    const now = new Date().toISOString();
    state.items[index] = {
      ...item,
      barcode,
      orderOptions: [{ ...option, barcode }],
      updatedAt: now,
      updatedBy: "기준바코드 동기화",
    };
    state.savedAt = now;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(
      new CustomEvent(EXTERNAL_STATE_EVENT, {
        detail: {
          typingGuardBypass: true,
          source: "single-option-barcode-sync",
          itemId,
        },
      }),
    );
  } catch (error) {
    console.warn("Single option barcode could not be saved.", error);
  }
}

function normalizeBarcode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function isLaunchSeedRequest(input) {
  try {
    const rawUrl = input instanceof Request ? input.url : String(input ?? "");
    return new URL(rawUrl, window.location.href).pathname.endsWith(SEED_PATH_SUFFIX);
  } catch {
    return false;
  }
}
