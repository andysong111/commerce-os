const SEO_BULK_ROUTE = "/seo-bulk-cloud";
const SEO_BULK_BATCH_STORAGE_KEY = "commerceOs.seoBulkCloud.batch.v1";
const NORMALIZED_ITEM_API = "/api/product-launch-tracker/normalized-optimized";
const BUTTON_ID = "seo-title-ledger-handoff-button";
const DATA_GROUP_ID = "bulk-action-group-data";
const MAX_INSTALL_ATTEMPTS = 40;
const MAX_BATCH_ITEMS = 50;
const ACTIVE_BATCH_MAX_AGE_MS = 8 * 60 * 60 * 1000;
let installAttempt = 0;
let installTimer = null;
let healthPanelScheduled = false;

function text(value) {
  return String(value ?? "").trim();
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function readSelectedItemIds() {
  return [
    ...document.querySelectorAll("#launch-table-body tr[data-id] .row-check:checked"),
  ]
    .map((checkbox) => checkbox.closest("tr[data-id]")?.dataset.id || "")
    .filter(Boolean);
}

function sourceUrlFromItem(item) {
  const source = record(item.source);
  const itemPayload = record(item.item_payload ?? item.itemPayload);
  const payloadSource = record(itemPayload.source);
  const candidates = [
    item.primaryChinaProductLink,
    itemPayload.primaryChinaProductLink,
    source.primaryChinaProductLink,
    payloadSource.primaryChinaProductLink,
    ...list(item.chinaProductLinks),
    ...list(itemPayload.chinaProductLinks),
    ...list(source.chinaProductLinks),
    ...list(payloadSource.chinaProductLinks),
    item.chinaOrderLink,
    itemPayload.chinaOrderLink,
  ]
    .map(text)
    .filter(Boolean);
  return candidates.find((value) => /^https?:\/\/(?:[^/]+\.)?1688\.com\//i.test(value)) || "";
}

function normalizedItemFields(raw) {
  const item = record(raw);
  const itemPayload = record(item.item_payload ?? item.itemPayload);
  return {
    id: text(item.id || item.item_id || itemPayload.id || itemPayload.itemId),
    trackerRowNumber: Number(
      item.trackerRowNumber ??
      item.tracker_row_number ??
      itemPayload.trackerRowNumber ??
      0,
    ) || 0,
    modelNumber: text(item.modelNumber || item.model_number || itemPayload.modelNumber),
    productName: text(item.productName || item.product_name || itemPayload.productName),
    sourceUrl: sourceUrlFromItem({ ...itemPayload, ...item }),
  };
}

async function readSelectedItem(itemId) {
  const query = new URLSearchParams({ mode: "item", id: itemId });
  const response = await fetch(`${NORMALIZED_ITEM_API}?${query.toString()}`, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true || !body?.item) {
    throw new Error(body?.message || `상품 정보를 불러오지 못했습니다. HTTP ${response.status}`);
  }
  return normalizedItemFields(body.item);
}

async function mapLimit(values, limit, worker) {
  const results = new Array(values.length);
  let cursor = 0;
  async function runner() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => runner()),
  );
  return results;
}

function showMessage(message) {
  if (typeof window.showToast === "function") {
    window.showToast(message);
    return;
  }
  window.alert(message);
}

function readActiveBatch() {
  try {
    const raw = window.localStorage.getItem(SEO_BULK_BATCH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.batchId || !Array.isArray(parsed.items)) return null;
    const createdAt = new Date(parsed.createdAt || parsed.updatedAt || 0).getTime();
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > ACTIVE_BATCH_MAX_AGE_MS) {
      return null;
    }
    return {
      ...parsed,
      items: parsed.items.filter((item) => text(item?.id)),
    };
  } catch {
    return null;
  }
}

function mergeBatchItems(existingItems, newItems) {
  const merged = [];
  const seen = new Set();
  for (const item of [...existingItems, ...newItems]) {
    const id = text(item?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(item);
  }
  return merged;
}

function buildAccumulatedBatch(items) {
  const existing = readActiveBatch();
  const mergedItems = mergeBatchItems(existing?.items || [], items);
  if (mergedItems.length > MAX_BATCH_ITEMS) {
    throw new Error(
      `기존 대기 ${existing?.items?.length || 0}개와 새 선택 ${items.length}개를 합치면 ${mergedItems.length}개입니다. 한 배치 최대 ${MAX_BATCH_ITEMS}개까지 처리합니다.`,
    );
  }
  const now = new Date().toISOString();
  return {
    version: 2,
    batchId:
      text(existing?.batchId) ||
      globalThis.crypto?.randomUUID?.() ||
      `seo-bulk-${Date.now()}`,
    createdAt: text(existing?.createdAt) || now,
    updatedAt: now,
    autoStart: true,
    items: mergedItems,
  };
}

function updateButton(button) {
  const selectedCount = readSelectedItemIds().length;
  const nextText = selectedCount
    ? `SEO 대량등록 클라우드 열기 (${selectedCount})`
    : "SEO 대량등록 클라우드 열기";
  if (button.textContent !== nextText) button.textContent = nextText;
  button.dataset.selectedCount = String(selectedCount);
}

async function openBulkCloud(button) {
  const selectedIds = readSelectedItemIds();
  if (!selectedIds.length) {
    showMessage("SEO 대량등록 클라우드에서 처리할 상품을 1개 이상 선택하세요.");
    return;
  }
  if (selectedIds.length > MAX_BATCH_ITEMS) {
    showMessage(`한 배치에서 최대 ${MAX_BATCH_ITEMS}개까지 처리합니다. 현재 ${selectedIds.length}개가 선택되었습니다.`);
    return;
  }

  button.disabled = true;
  const original = button.textContent;
  button.textContent = `${selectedIds.length}개 상품 확인 중…`;
  try {
    const items = await mapLimit(selectedIds, 8, readSelectedItem);
    const missingLinks = items.filter((item) => !item.sourceUrl);
    if (missingLinks.length) {
      const labels = missingLinks
        .slice(0, 5)
        .map((item) => item.modelNumber || item.productName || item.id)
        .join(", ");
      throw new Error(
        `${missingLinks.length}개 상품에 1688 링크가 없습니다: ${labels}${missingLinks.length > 5 ? " 외" : ""}`,
      );
    }

    const batch = buildAccumulatedBatch(items);
    window.localStorage.setItem(SEO_BULK_BATCH_STORAGE_KEY, JSON.stringify(batch));
    window.dispatchEvent(
      new CustomEvent("commerce-os:seo-bulk-batch-updated", {
        detail: { batchId: batch.batchId, itemCount: batch.items.length },
      }),
    );
    const target = `${SEO_BULK_ROUTE}?${new URLSearchParams({ batchId: batch.batchId }).toString()}`;
    const opened = window.open(target, "_blank");
    if (!opened) {
      window.location.assign(target);
      return;
    }
    try {
      opened.opener = null;
    } catch {
      // New tab still works when opener changes are blocked.
    }
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "SEO 대량등록 클라우드로 이동하지 못했습니다.");
  } finally {
    button.disabled = false;
    button.textContent = original || "SEO 대량등록 클라우드 열기";
    updateButton(button);
  }
}

function installButton() {
  const controls = document.querySelector(".bulk-controls");
  const dataGroup = document.querySelector(`#${DATA_GROUP_ID}`);
  const destination = dataGroup || controls;
  if (!destination) return false;

  let button = document.querySelector(`#${BUTTON_ID}`);
  if (!button) {
    button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "button seo-title-ledger-button";
    button.addEventListener("click", () => void openBulkCloud(button));
  }
  if (button.parentElement !== destination) destination.append(button);
  if (!button.disabled) updateButton(button);
  return true;
}

function installStyles() {
  if (document.querySelector("#seo-title-ledger-handoff-style")) return;
  const style = document.createElement("style");
  style.id = "seo-title-ledger-handoff-style";
  style.textContent = `
    .seo-title-ledger-button {
      border: 1px solid #7c3aed !important;
      background: #6d28d9 !important;
      color: #fff !important;
      font-weight: 850 !important;
      min-width: 190px;
    }
    .seo-title-ledger-button:hover { background: #5b21b6 !important; }
    .seo-title-ledger-button:disabled { cursor: wait; opacity: .55; }
  `;
  document.head.append(style);
}

function scheduleInstall(reset = false) {
  if (reset) installAttempt = 0;
  if (installTimer) {
    window.clearTimeout(installTimer);
    installTimer = null;
  }
  installStyles();
  if (installButton()) return;
  if (installAttempt >= MAX_INSTALL_ATTEMPTS) return;
  installAttempt += 1;
  installTimer = window.setTimeout(() => scheduleInstall(false), 100);
}

function scheduleHealthPanel() {
  if (healthPanelScheduled) return;
  healthPanelScheduled = true;
  const load = () => {
    void Promise.all([
      import("./china-link-health-panel.js"),
      import("./china-link-health-run-state.js"),
    ]).catch((error) => {
      console.error("China primary link health panel failed to load", error);
    });
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(load, { timeout: 2_000 });
  } else {
    window.setTimeout(load, 700);
  }
}

function handleSelectionChange(event) {
  if (
    !(event.target instanceof Element) ||
    !event.target.matches(".row-check, #select-visible")
  ) {
    return;
  }
  const button = document.querySelector(`#${BUTTON_ID}`);
  if (button && !button.disabled) {
    updateButton(button);
    return;
  }
  scheduleInstall(true);
}

function handlePageLoaded() {
  scheduleInstall(true);
}

scheduleInstall(true);
scheduleHealthPanel();
document.addEventListener("change", handleSelectionChange, true);
window.addEventListener("product-launch-tracker:page-loaded", handlePageLoaded);
window.addEventListener(
  "pagehide",
  () => {
    if (installTimer) window.clearTimeout(installTimer);
    document.removeEventListener("change", handleSelectionChange, true);
    window.removeEventListener("product-launch-tracker:page-loaded", handlePageLoaded);
  },
  { once: true },
);
