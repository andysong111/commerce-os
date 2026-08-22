const SEO_LEDGER_ROUTE = "/keyword-engine-elon-lab";
const NORMALIZED_ITEM_API = "/api/product-launch-tracker/normalized-optimized";
const BUTTON_ID = "seo-title-ledger-handoff-button";
const DATA_GROUP_ID = "bulk-action-group-data";

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
    modelNumber: text(
      item.modelNumber ||
      item.model_number ||
      itemPayload.modelNumber,
    ),
    productName: text(
      item.productName ||
      item.product_name ||
      itemPayload.productName,
    ),
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

function showMessage(message) {
  if (typeof window.showToast === "function") {
    window.showToast(message);
    return;
  }
  window.alert(message);
}

function updateButton(button) {
  const selectedCount = readSelectedItemIds().length;
  button.textContent = selectedCount === 1
    ? "선택 상품 SEO 대량등록 클라우드 열기"
    : `SEO 대량등록 클라우드 열기${selectedCount ? ` (${selectedCount})` : ""}`;
  button.dataset.selectedCount = String(selectedCount);
}

async function openLedger(button) {
  const selectedIds = readSelectedItemIds();
  if (selectedIds.length !== 1) {
    showMessage("SEO 대량등록 클라우드는 상품 한 개씩 원장을 생성합니다. 상품을 정확히 1개 선택하세요.");
    return;
  }

  button.disabled = true;
  const original = button.textContent;
  button.textContent = "상품 링크 확인 중…";
  try {
    const item = await readSelectedItem(selectedIds[0]);
    if (!item.sourceUrl) {
      throw new Error(
        `${item.modelNumber || item.productName || "선택 상품"}: 1688 상품 링크가 없습니다. 상품 상세의 중국 상품 링크를 먼저 확인하세요.`,
      );
    }
    const query = new URLSearchParams({
      launchItemId: item.id || selectedIds[0],
      trackerRowNumber: item.trackerRowNumber ? String(item.trackerRowNumber) : "",
      modelNumber: item.modelNumber,
      productName: item.productName,
      sourceUrl: item.sourceUrl,
    });
    const target = `${SEO_LEDGER_ROUTE}?${query.toString()}`;
    if (window.top && window.top !== window) {
      window.top.location.assign(target);
    } else {
      window.location.assign(target);
    }
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "SEO 대량등록 클라우드로 이동하지 못했습니다.");
    button.disabled = false;
    button.textContent = original || "선택 상품 SEO 대량등록 클라우드 열기";
  }
}

function installButton() {
  const controls = document.querySelector(".bulk-controls");
  const dataGroup = document.querySelector(`#${DATA_GROUP_ID}`);
  const destination = dataGroup || controls;
  if (!destination) return;

  let button = document.querySelector(`#${BUTTON_ID}`);
  if (!button) {
    button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "button seo-title-ledger-button";
    button.addEventListener("click", () => void openLedger(button));
  }
  if (button.parentElement !== destination) destination.append(button);
  updateButton(button);
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

function sync() {
  installStyles();
  installButton();
  const button = document.querySelector(`#${BUTTON_ID}`);
  if (button && !button.disabled) updateButton(button);
}

sync();
document.addEventListener("change", (event) => {
  if (event.target instanceof Element && event.target.matches(".row-check, #select-visible")) {
    window.setTimeout(sync, 0);
  }
}, true);
window.addEventListener("product-launch-tracker:page-loaded", sync);
const observer = new MutationObserver(sync);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
