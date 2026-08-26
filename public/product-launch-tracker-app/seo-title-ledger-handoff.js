const SEO_BULK_ROUTE = "/seo-bulk-cloud";
const SEO_BULK_BATCH_STORAGE_KEY = "commerceOs.seoBulkCloud.batch.v1";
const SEO_BULK_WINDOW_NAME = "commerce-os-seo-bulk-cloud";
const SEO_BULK_REVISION_PARAM = "rev";
const NORMALIZED_ITEM_API = "/api/product-launch-tracker/normalized-optimized";
const BUTTON_ID = "seo-title-ledger-handoff-button";
const DATA_GROUP_ID = "bulk-action-group-data";
const MAX_INSTALL_ATTEMPTS = 40;
const MAX_BATCH_ITEMS = 50;
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

function readPendingBatch() {
  try {
    const raw = window.localStorage.getItem(SEO_BULK_BATCH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function mergePendingItems(previousItems, nextItems) {
  const merged = new Map();
  for (const item of [...listOfRecords(previousItems), ...listOfRecords(nextItems)]) {
    const id = text(item.id);
    if (!id) continue;
    merged.set(id, { ...record(merged.get(id)), ...item, id });
  }
  return [...merged.values()];
}

function listOfRecords(value) {
  return Array.isArray(value) ? value.map(record) : [];
}

function batchItemSignature(items) {
  return listOfRecords(items)
    .map((item) => [
      text(item.id),
      text(item.modelNumber),
      text(item.productName),
      text(item.sourceUrl),
    ].join("|"))
    .filter(Boolean)
    .sort()
    .join("||");
}

function showMessage(message) {
  if (typeof window.showToast === "function") {
    window.showToast(message);
    return;
  }
  window.alert(message);
}

function updateButton(button) {
  const selectedCount = readSelectedItemIds().length;
  const nextText = selectedCount
    ? `SEO 대량등록 클라우드 열기 (${selectedCount})`
    : "SEO 대량등록 클라우드 열기";
  if (button.textContent !== nextText) button.textContent = nextText;
  button.dataset.selectedCount = String(selectedCount);
}

function isSeoBulkWindow(opened) {
  try {
    return (
      opened.location.origin === window.location.origin &&
      opened.location.pathname === SEO_BULK_ROUTE
    );
  } catch {
    return false;
  }
}

function seoBulkWindowRevision(opened) {
  try {
    return new URLSearchParams(opened.location.search).get(SEO_BULK_REVISION_PARAM) || "";
  } catch {
    return "";
  }
}

function isSeoBulkWindowBusy(opened) {
  try {
    const bodyText = opened.document?.body?.innerText || "";
    return /FINAL 생성 중|원본 준비 중|STEP\s*[1-4]\s*·|조립 중|원장에 저장 중/.test(bodyText);
  } catch {
    return false;
  }
}

function openOrFocusBulkWindow(target, revision) {
  const opened = window.open("", SEO_BULK_WINDOW_NAME);
  if (!opened) {
    window.location.assign(target);
    return;
  }

  const existingCloud = isSeoBulkWindow(opened);
  if (existingCloud && seoBulkWindowRevision(opened) === revision) {
    opened.focus();
    return;
  }

  if (existingCloud && isSeoBulkWindowBusy(opened)) {
    opened.focus();
    showMessage(
      "현재 SEO 대량등록 클라우드가 생성 중입니다. 새 선택은 대기 묶음에 저장했습니다. 현재 생성이 끝난 뒤 SEO 클라우드 버튼을 한 번 더 누르면 같은 창에 반영됩니다.",
    );
    return;
  }

  try {
    opened.location.href = target;
    opened.focus();
    opened.opener = null;
  } catch {
    window.location.assign(target);
  }
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

    const previousBatch = readPendingBatch();
    const mergedItems = mergePendingItems(previousBatch?.items, items);
    if (mergedItems.length > MAX_BATCH_ITEMS) {
      throw new Error(
        `아직 Shopling 일괄등록하지 않은 기존 상품과 합치면 ${mergedItems.length}개가 됩니다. 한 대기 묶음은 최대 ${MAX_BATCH_ITEMS}개입니다.`,
      );
    }

    const batchId =
      text(previousBatch?.batchId) ||
      globalThis.crypto?.randomUUID?.() ||
      `seo-bulk-${Date.now()}`;
    const now = new Date().toISOString();
    const previousSignature =
      text(previousBatch?.itemSignature) || batchItemSignature(previousBatch?.items);
    const itemSignature = batchItemSignature(mergedItems);
    const changed = previousSignature !== itemSignature;
    const revision = changed
      ? now
      : text(previousBatch?.revision) || text(previousBatch?.updatedAt) || now;
    const batch = {
      version: 2,
      batchId,
      createdAt: text(previousBatch?.createdAt) || now,
      updatedAt: changed ? now : text(previousBatch?.updatedAt) || now,
      revision,
      itemSignature,
      autoStart: true,
      items: mergedItems,
    };
    window.localStorage.setItem(SEO_BULK_BATCH_STORAGE_KEY, JSON.stringify(batch));
    const target = `${SEO_BULK_ROUTE}?${new URLSearchParams({
      batchId,
      [SEO_BULK_REVISION_PARAM]: revision,
    }).toString()}`;
    openOrFocusBulkWindow(target, revision);
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
